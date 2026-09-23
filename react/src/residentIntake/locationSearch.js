import { toNeutralLocation, validateMapData } from "../map/geospatialData.js";

export const LOCATION_QUERY_MIN = 3;
export const LOCATION_RESULT_LIMIT = 5;
export const LOCATION_DEBOUNCE_MS = 300;

export function normalizeLocationResult(value) {
  const point = toNeutralLocation([value?.longitude, value?.latitude]);
  if (
    !point ||
    typeof value?.id !== "string" ||
    !value.id ||
    typeof value.displayLabel !== "string" ||
    !value.displayLabel.trim() ||
    value.displayLabel.length > 2000
  )
    return null;
  return { id: value.id, displayLabel: value.displayLabel.trim(), ...point };
}

export function createDevelopmentLocationSearch(locations) {
  const rows = (Array.isArray(locations) ? locations : [])
    .map(normalizeLocationResult)
    .filter(Boolean)
    .slice(0, 20);
  return {
    async search(query, { signal } = {}) {
      if (signal?.aborted) return [];
      const normalized = query.trim().toLowerCase();
      return normalized.length < LOCATION_QUERY_MIN
        ? []
        : rows
            .filter((row) =>
              row.displayLabel.toLowerCase().includes(normalized),
            )
            .slice(0, LOCATION_RESULT_LIMIT);
    },
  };
}

export function createIntakeLocationRepository(client) {
  return {
    async load({ signal } = {}) {
      const result = await client.get("/intake/location", { signal });
      if (result?.mode !== "synthetic")
        return { boundary: null, search: null, synthetic: false };
      // Validate the same narrow GeoJSON subset; no staff layers are consumed.
      const data = validateMapData(
        {
          organizationId: "intake",
          boundary: result.boundary,
          requests: { type: "FeatureCollection", features: [] },
        },
        "intake",
      );
      return {
        boundary: data.boundary,
        search: createDevelopmentLocationSearch(result.locations),
        synthetic: true,
      };
    },
  };
}

export function boundaryContains(point, boundary) {
  const ring = boundary?.geometry?.coordinates?.[0];
  if (!point || !ring) return null;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i],
      [px, py] = ring[j];
    const cross =
      (point.longitude - px) * (y - py) - (point.latitude - py) * (x - px);
    if (
      Math.abs(cross) <= 1e-12 &&
      point.longitude >= Math.min(x, px) &&
      point.longitude <= Math.max(x, px) &&
      point.latitude >= Math.min(y, py) &&
      point.latitude <= Math.max(y, py)
    )
      return true;
    if (
      y > point.latitude !== py > point.latitude &&
      point.longitude < ((px - x) * (point.latitude - y)) / (py - y) + x
    )
      inside = !inside;
  }
  return inside;
}
