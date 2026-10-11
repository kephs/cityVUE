import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const pin = JSON.parse(read("deploy/frontend/nginx/image-pin.json"));
const dockerfile = read("deploy/frontend/Dockerfile");
const lines = dockerfile.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const validBase =
  /^ghcr\.io\/nginx\/nginx-unprivileged:1\.30\.5-trixie@sha256:[a-f0-9]{64}$/;
test("FROM exactly matches verified multi-platform pin", () => {
  const from = lines.filter((l) => l.startsWith("FROM "));
  assert.equal(from.length, 1);
  const ref = from[0].slice(5);
  assert.match(ref, validBase);
  assert.equal(
    ref,
    pin.registry + "/" + pin.repository + ":" + pin.tag + "@" + pin.digest,
  );
  assert.equal(pin.digestType, "multi-platform OCI image index");
  assert.ok(
    pin.platforms.includes("linux/amd64") &&
      pin.platforms.includes("linux/arm64"),
  );
  assert.notEqual(pin.digest, pin.localChildDigest);
});
test("floating and unapproved variants fail reference contract", () => {
  for (const ref of [
    "nginx:latest",
    "nginx:mainline",
    "nginx:alpine",
    "ghcr.io/nginx/nginx-unprivileged:stable",
    "ghcr.io/nginx/nginx-unprivileged:1.30",
    "ghcr.io/nginx/nginx-unprivileged:1.30.5-trixie",
    "ghcr.io/nginx/nginx-unprivileged:1.30.5-trixie-perl@" + pin.digest,
  ])
    assert.equal(validBase.test(ref), false, ref);
});
test("non-root runtime port without packages or secret ARG/ENV", () => {
  assert.ok(lines.includes("USER 101:101"));
  assert.ok(lines.includes("EXPOSE 8080"));
  assert.equal(pin.requiresNonRoot, true);
  assert.equal(pin.containerPort, 8080);
  assert.ok(
    lines.every((l) => /^(FROM|COPY|USER|EXPOSE|ENTRYPOINT|CMD) /.test(l)),
  );
  assert.doesNotMatch(
    dockerfile,
    /USER\s+(root|0)\b|--platform|^\s*(ARG|ENV|RUN|ADD|HEALTHCHECK)\b/m,
  );
});
test("only artifacts/config copied; no API-dependent entrypoint", () => {
  assert.deepEqual(
    lines.filter((l) => l.startsWith("COPY ")),
    [
      "COPY --chown=101:101 dist-react/ /usr/share/nginx/html/",
      "COPY --chown=101:101 deploy/frontend/nginx/nginx.conf /etc/nginx/nginx.conf",
    ],
  );
  assert.ok(lines.includes('ENTRYPOINT ["nginx"]'));
  assert.ok(lines.includes('CMD ["-g", "daemon off;"]'));
  const ignore = read("deploy/frontend/Dockerfile.dockerignore");
  assert.equal(ignore.split(/\r?\n/)[0], "**");
  assert.doesNotMatch(ignore, /!\.env|!server|!\.git/);
});
test("temporary paths and headers retain runtime boundaries", () => {
  const config = read("deploy/frontend/nginx/nginx.conf");
  assert.match(config, /listen 8080 default_server;/);
  assert.doesNotMatch(
    config,
    /Content-Security-Policy|Strict-Transport-Security|proxy_pass|upstream/,
  );
  for (const prefix of ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"])
    assert.match(config, new RegExp(prefix + "_temp_path /tmp/"));
});
