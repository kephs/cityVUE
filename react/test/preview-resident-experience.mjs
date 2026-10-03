// Explicit local visual fixture harness. Never imported by the application/build.
// Compile server tests first: npm --prefix server run test:compile
// Run from the repository root: node react/test/preview-resident-experience.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import config from "../vite.config.mjs";
import {
  publishedExperienceFixture,
  publishedSnapshotFixture,
} from "./fixtures/residentExperience.js";
import { projectPublishedResidentExperience } from "../../server/dist-test/src/resident-experience/resident-experience.public.dto.js";

const publication = projectPublishedResidentExperience(
  publishedSnapshotFixture(),
);
assert.deepEqual(publication, publishedExperienceFixture());
const origin = "http://127.0.0.1:5173";
const server = await createServer({
  ...config,
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  envFile: false,
  envDir: false,
  define: {
    "import.meta.env.VITE_CITYVUE_DATA_SOURCE": JSON.stringify("api"),
    "import.meta.env.VITE_CITYVUE_API_BASE_URL": JSON.stringify(
      `${origin}/api/v1`,
    ),
    "import.meta.env.VITE_ENTRA_TENANT_ID": JSON.stringify(""),
    "import.meta.env.VITE_ENTRA_WEB_CLIENT_ID": JSON.stringify(""),
    "import.meta.env.VITE_ENTRA_API_SCOPE": JSON.stringify(""),
  },
  server: { ...config.server, host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [
    {
      name: "explicit-reqro-publication-fixture",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith("/api/")) return next();
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "application/json");
          if (
            request.method === "GET" &&
            request.url === "/api/v1/resident-experience"
          ) {
            response.end(JSON.stringify(publication));
          } else if (
            request.method === "GET" &&
            request.url === "/api/v1/alerts/active"
          ) {
            response.end("[]");
          } else {
            response.statusCode = 404;
            response.end(
              JSON.stringify({
                message: "Not available in visual fixture preview",
              }),
            );
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(`Explicit Reqro published fixture preview: ${origin}`);
console.log(
  "Visual UAT only; no database, publication writes, or environment files. Ctrl+C to stop.",
);
