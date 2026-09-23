import { defineConfig } from "vite";

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
  server: { fs: { deny: privateFileDeny } },
});
