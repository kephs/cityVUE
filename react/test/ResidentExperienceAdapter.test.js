import { expect, test, vi, afterEach } from "vitest";
import { adaptResidentExperience } from "../src/pages/home/residentExperienceAdapter.js";
import { safeHomePresentation } from "../src/pages/home/safeHomePresentation.js";
import { homePresentation } from "../src/pages/home/homePresentation.js";
import { loadResidentExperience } from "../src/pages/home/residentExperienceRepository.js";
import { publishedExperienceFixture } from "./fixtures/residentExperience.js";
afterEach(() => vi.unstubAllGlobals());
test("complete DTO maps to the frozen reference shape with contact-derived phone labels", () => {
  const result = adaptResidentExperience(publishedExperienceFixture());
  expect(result).toEqual({
    ...homePresentation,
    hero: {
      ...homePresentation.hero,
      headline: homePresentation.hero.headline.map((s) => ({
        ...s,
        highlighted: s.highlighted === true,
      })),
    },
    actions: homePresentation.actions.map((a) => ({
      ...a,
      target: a.actionType === "phone" ? a.target.replace(/\D/g, "") : a.target,
    })),
  });
});
test("no publication and legacy mode use generic fallback without phone or emergency guidance", async () => {
  expect(
    adaptResidentExperience({ schemaVersion: 1, configuration: null }),
  ).toBe(safeHomePresentation);
  expect(
    await loadResidentExperience({ config: { dataSource: "legacy" } }),
  ).toBe(safeHomePresentation);
  expect(JSON.stringify(safeHomePresentation)).not.toMatch(
    /911|240-314|emergency|call immediately/i,
  );
  expect(safeHomePresentation.actions.map((a) => a.target)).toEqual([
    "/report",
  ]);
});
test("repository requests one anonymous endpoint without Organization selectors", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => publishedExperienceFixture(),
  });
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await loadResidentExperience({
    signal: controller.signal,
    config: { dataSource: "api", apiBaseUrl: "https://example.org/api/v1" },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://example.org/api/v1/resident-experience");
  expect(options.headers).toEqual({ Accept: "application/json" });
  expect(options.method).toBe("GET");
});
test("empty and disabled action collections never restore defaults", () => {
  const dto = publishedExperienceFixture();
  dto.configuration.actions = [];
  expect(adaptResidentExperience(dto).actions).toEqual([]);
  dto.configuration.actions =
    publishedExperienceFixture().configuration.actions.map((a) => ({
      ...a,
      enabled: false,
    }));
  expect(adaptResidentExperience(dto).actions).toEqual([]);
});
test.each([
  "https://evil.example/image.svg",
  "reqro-scenery",
  "constructor",
  "unknown",
])("unknown/wrong-role asset %s uses packaged role fallback", (key) => {
  const dto = publishedExperienceFixture();
  dto.configuration.presentation.branding.logoKey = key;
  expect(adaptResidentExperience(dto).logo).toBe(safeHomePresentation.logo);
});
test("unknown theme maps only to Reqro", () => {
  const dto = publishedExperienceFixture();
  dto.configuration.presentation.branding.themeKey = "arbitrary-css";
  expect(adaptResidentExperience(dto).theme).toBe("reqro");
});
test.each([
  [
    "unknown root field",
    (dto) => {
      dto.actorId = "private";
    },
  ],
  [
    "unknown version",
    (dto) => {
      dto.schemaVersion = 2;
    },
  ],
  [
    "missing asset",
    (dto) => {
      delete dto.configuration.presentation.hero.assetKey;
    },
  ],
  [
    "markup",
    (dto) => {
      dto.configuration.presentation.metadata.title = "<script>";
    },
  ],
  [
    "staff route",
    (dto) => {
      dto.configuration.actions[0].target = "/admin";
    },
  ],
  [
    "unknown icon",
    (dto) => {
      dto.configuration.actions[0].iconKey = "moon";
    },
  ],
  [
    "phone mismatch",
    (dto) => {
      dto.configuration.actions[1].target = "123";
    },
  ],
  [
    "extra style",
    (dto) => {
      dto.configuration.presentation.hero.style = "red";
    },
  ],
  [
    "duplicate ID",
    (dto) => {
      dto.configuration.actions[1].id = "report";
    },
  ],
  [
    "excess actions",
    (dto) => {
      dto.configuration.actions = Array(7).fill(dto.configuration.actions[0]);
    },
  ],
])("malformed DTO rejects atomically: %s", (_, mutate) => {
  const dto = publishedExperienceFixture();
  mutate(dto);
  expect(() => adaptResidentExperience(dto)).toThrow(
    "Invalid public resident experience",
  );
});
