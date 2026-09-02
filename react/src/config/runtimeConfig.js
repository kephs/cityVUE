export const DATA_SOURCES = Object.freeze({ legacy: "legacy", api: "api" });

export function readResidentIntakeConfig(environment = import.meta.env) {
    const dataSource = String(environment?.VITE_CITYVUE_DATA_SOURCE || DATA_SOURCES.legacy).trim().toLowerCase();
    if (!Object.values(DATA_SOURCES).includes(dataSource)) {
        throw new Error("VITE_CITYVUE_DATA_SOURCE must be either legacy or api.");
    }

    const apiBaseUrl = String(environment?.VITE_CITYVUE_API_BASE_URL || "").trim().replace(/\/$/, "");
    if (dataSource === DATA_SOURCES.api) {
        if (!apiBaseUrl) throw new Error("VITE_CITYVUE_API_BASE_URL is required in api mode.");
        let parsed;
        try { parsed = new URL(apiBaseUrl); } catch { throw new Error("VITE_CITYVUE_API_BASE_URL must be a valid HTTP(S) URL."); }
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("VITE_CITYVUE_API_BASE_URL must be a valid HTTP(S) URL.");
    }
    return { dataSource, apiBaseUrl };
}
