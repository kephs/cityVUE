import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        include: ["react/test/**/*.test.{js,jsx}"],
        setupFiles: ["./react/test/setup.js"]
    }
});
