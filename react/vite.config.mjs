import { defineConfig } from "vite";
import { assertClientServingConfig } from "./src/config/servingConfig.mjs";

export const privateFileDeny = [
  // Retain Vite's default sensitive-file protection when extending this list.
  ".env",
  ".env.*",
  "*.{crt,pem,key,p12,pfx,cer,der}",
  ".npmrc",
  ".yarnrc.yml",
  "**/.git/**",
  "**/.local-data/**",
  "**/.local-uat/**",
];

export default defineConfig({
  plugins: [
    {
      name: "reqro-serving-configuration",
      configResolved(config) {
        // Vite has loaded mode-specific files and applied process environment
        // precedence. Validate exactly the public values embedded in the build.
        assertClientServingConfig(config.env);
      },
    },
  ],
  server: { fs: { deny: privateFileDeny } },
});
