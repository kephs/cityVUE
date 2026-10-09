# =====================================================================
# Reqro tenant-domain operator job image  --  ADR-028 F060.3C-2e-1
# =====================================================================
#
# A provider-neutral build definition for the one-shot operator job. It
# names no CI system, no cloud registry and no deployment: selecting a
# runner (GitHub Actions, Azure DevOps or anything else) is a separate
# authorized decision, and nothing here presumes one.
#
# Build from the `server` directory, which is the context:
#
#     docker build -f deploy/operator/Dockerfile -t <registry>/reqro-operator:<digest-tag> .
#
# WHAT THIS IMAGE DELIBERATELY DOES NOT CONTAIN
#
#   * No credential, secret, token or `.env` file of any kind. The database
#     credential arrives at run time from the deployment secret manager
#     through DATABASE_URL and is never baked, defaulted or echoed.
#   * No `tsx` and no TypeScript sources in the final stage. The job runs
#     the compiled artifact, so what executes in production is what was
#     built and digested -- not a working tree transpiled on the fly.
#   * No shell entry point wrapper that could rewrite arguments or inject
#     an identity. The operator command is the process.
#
# PROVENANCE
#
# The operator path refuses to run in a serving environment without both a
# full 40-character commit SHA and an immutable sha256 image digest; a
# branch name or a mutable tag such as `:latest` is rejected because it is
# not provenance. REQRO_OPERATOR_COMMIT_SHA is supplied as a build argument
# and baked, because the commit a built image came from is a property of
# the image. REQRO_OPERATOR_IMAGE_DIGEST is NOT baked and cannot be: an
# image's own digest is not known until after it is built and pushed. The
# runner injects it at job start from the registry reference it actually
# pulled, which is also the only value that proves what ran.

FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS operator

# Serving-environment semantics across the operator boundary are keyed on
# the production runtime, matching the application image.
ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Baked provenance. Passed with --build-arg REQRO_OPERATOR_COMMIT_SHA=$(git rev-parse HEAD);
# the operator path refuses a short SHA, a tag or a branch name.
ARG REQRO_OPERATOR_COMMIT_SHA
ENV REQRO_OPERATOR_COMMIT_SHA=${REQRO_OPERATOR_COMMIT_SHA}

# Non-root. The `node` user ships with the base image, so no account is
# created here. The job needs no write access to the filesystem: it opens a
# database connection and writes its audit records to stderr.
USER node

# No EXPOSE and no long-running server. This is a one-shot job: it performs
# exactly one operator verb and exits, and its exit code is the job's.
#
# The verb and mode are the job's arguments, for example:
#     activate --dry-run
# Every trusted execution field -- IAM subject, permissions, elevation
# window, runner identity, job run id, image digest -- is injected by the
# runner as environment, never as an argument, so no argument a human edits
# can change who the actor is.
ENTRYPOINT ["node", "dist/database/tenant-domain-operator-cli.js"]
CMD ["--help"]
