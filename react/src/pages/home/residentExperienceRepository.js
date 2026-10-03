import { createApiClient } from "../../api/apiClient.js";
import { readResidentIntakeConfig } from "../../config/runtimeConfig.js";
import { adaptResidentExperience } from "./residentExperienceAdapter.js";
import { safeHomePresentation } from "./safeHomePresentation.js";

export async function loadResidentExperience({
  signal,
  config = readResidentIntakeConfig(),
} = {}) {
  if (config.dataSource !== "api") return safeHomePresentation;
  const dto = await createApiClient({ baseUrl: config.apiBaseUrl }).get(
    "/resident-experience",
    { signal },
  );
  return adaptResidentExperience(dto);
}
