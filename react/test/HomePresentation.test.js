import { describe, expect, test } from "vitest";
import { actionHref, localAsset, iconAsset, toneChoice, themeChoice } from "../src/pages/home/presentationPolicy.js";
describe("homepage presentation boundaries", () => {
  test.each([
    ["internal", "/report", "/report"],
    ["internal", "/report?source=home#start", "/report?source=home#start"],
    ["external", "https://example.org/help", "https://example.org/help"],
    ["phone", "+1-202-555-0100", "tel:+12025550100"],
  ])("allows %s destination %s", (actionType, target, expected) => {
    expect(actionHref({ actionType, target })).toBe(expected);
  });
  test.each([
    ["internal", "//example.org"], ["internal", "/\\evil"], ["internal", "javascript:alert(1)"],
    ["internal", "/\n/evil"], ["external", "http://example.org"], ["external", "javascript:alert(1)"],
    ["external", "https://user:secret@example.org"], ["external", "data:text/html,hi"],
    ["external", "not a URL"], ["phone", "911;postd=123"], ["phone", "javascript:alert(1)"],
    ["phone", ""], ["script", "/report"],
  ])("rejects unsafe %s target %s", (actionType, target) => {
    expect(actionHref({ actionType, target })).toBeNull();
  });
  test("asset and style choices use allowlists", () => {
    expect(localAsset("/branding/reqro/hero/reqro-home-background.png")).toBeTruthy();
    for (const path of ["https://example.org/image.png", "/branding/../secret.png", "data:image/svg+xml,x"]) expect(localAsset(path)).toBeUndefined();
    expect(iconAsset("report")).toMatch(/action-report.svg$/);
    expect(iconAsset("constructor")).toBeNull();
    expect(toneChoice("red; color: green")).toBe("primary");
    expect(themeChoice("arbitrary-css")).toBe("reqro");
  });
});
