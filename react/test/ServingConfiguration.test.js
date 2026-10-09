import { describe, expect, test } from "vitest";
import { readResidentIntakeConfig } from "../src/config/runtimeConfig.js";
import viteConfig from "../vite.config.mjs";

const client = {
  PROD: true,
  VITE_CITYVUE_DEPLOYMENT_PROFILE: "client",
  VITE_CITYVUE_DATA_SOURCE: "api",
};

describe("production client serving configuration", () => {
  test.each([undefined, "", "  "])(
    "uses same-origin API for absent/empty override %s",
    (override) => {
      const result = readResidentIntakeConfig({
        ...client,
        VITE_CITYVUE_API_BASE_URL: override,
      });
      expect(result.dataSource).toBe("api");
      expect(result.apiBaseUrl).toBe("/api/v1");
      expect(result.developmentReadsEnabled).toBe(false);
    },
  );
  test.each([
    { VITE_CITYVUE_DATA_SOURCE: undefined },
    { VITE_CITYVUE_DATA_SOURCE: "legacy" },
    { VITE_CITYVUE_DATA_SOURCE: "other" },
    { VITE_CITYVUE_API_BASE_URL: "/api/v1" },
    { VITE_CITYVUE_API_BASE_URL: "/" },
    { VITE_CITYVUE_API_BASE_URL: "https://api.example.gov/api/v1" },
    { VITE_CITYVUE_API_BASE_URL: "http://localhost:3000/api/v1" },
    { VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: "true" },
    { VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: "typo" },
    { VITE_CITYVUE_DEPLOYMENT_PROFILE: "other" },
    { VITE_CITYVUE_DEPLOYMENT_PROFILE: undefined },
    { PROD: false },
  ])("rejects unsafe client settings %j", (settings) => {
    expect(() =>
      readResidentIntakeConfig({ ...client, ...settings }),
    ).toThrow();
  });
  test("build hook validates Vite resolved values before producing an artifact", () => {
    const plugin = viteConfig.plugins.find(
      (entry) => entry.name === "reqro-serving-configuration",
    );
    expect(() => plugin.configResolved({ env: client })).not.toThrow();
    expect(() =>
      plugin.configResolved({
        env: { ...client, VITE_CITYVUE_DATA_SOURCE: "legacy" },
      }),
    ).toThrow(/DATA_SOURCE/);
  });
  test("local API overrides and legacy demonstration builds remain available", () => {
    expect(
      readResidentIntakeConfig({
        PROD: false,
        VITE_CITYVUE_DATA_SOURCE: "api",
        VITE_CITYVUE_API_BASE_URL: "http://localhost:3000/api/v1",
      }).apiBaseUrl,
    ).toBe("http://localhost:3000/api/v1");
    expect(readResidentIntakeConfig({ PROD: true }).dataSource).toBe("legacy");
    expect(() =>
      readResidentIntakeConfig({
        VITE_CITYVUE_DATA_SOURCE: "api",
        VITE_CITYVUE_API_BASE_URL: "/api/v1",
      }),
    ).toThrow(/BASE_URL/);
  });
  test("existing complete Entra configuration is unchanged", () => {
    const result = readResidentIntakeConfig({
      ...client,
      VITE_ENTRA_TENANT_ID: "fictional-tenant",
      VITE_ENTRA_WEB_CLIENT_ID: "fictional-client",
      VITE_ENTRA_API_SCOPE: "api://fictional/access_as_user",
    });
    expect(result.entra).toEqual({
      enabled: true,
      tenantId: "fictional-tenant",
      webClientId: "fictional-client",
      apiScope: "api://fictional/access_as_user",
    });
    expect(() =>
      readResidentIntakeConfig({
        ...client,
        VITE_ENTRA_TENANT_ID: "fictional-tenant",
      }),
    ).toThrow(/All CityVUE Entra/);
  });
});
