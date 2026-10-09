/** Public build settings only. This profile is not an Organization selector. */
export function assertClientServingConfig(environment) {
  const profile = String(
    environment?.VITE_CITYVUE_DEPLOYMENT_PROFILE || "development",
  ).trim();
  if (!["development", "client"].includes(profile)) {
    throw new Error(
      "VITE_CITYVUE_DEPLOYMENT_PROFILE must be development or client.",
    );
  }
  const source = String(environment?.VITE_CITYVUE_DATA_SOURCE || "legacy")
    .trim()
    .toLowerCase();
  if (environment?.PROD === true && source === "api" && profile !== "client") {
    throw new Error(
      "Production API builds require VITE_CITYVUE_DEPLOYMENT_PROFILE=client.",
    );
  }
  if (profile !== "client") return;
  if (environment?.PROD !== true) {
    throw new Error(
      "The client serving profile requires a production frontend build.",
    );
  }
  if (source !== "api") {
    throw new Error("Client serving requires VITE_CITYVUE_DATA_SOURCE=api.");
  }
  if (String(environment?.VITE_CITYVUE_API_BASE_URL || "").trim()) {
    throw new Error(
      "Client serving requires VITE_CITYVUE_API_BASE_URL absent/empty for same-origin /api/v1.",
    );
  }
  const reads = String(
    environment?.VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS ||
      "false",
  )
    .trim()
    .toLowerCase();
  if (reads !== "false") {
    throw new Error(
      "Client serving requires development service request reads disabled.",
    );
  }
}
