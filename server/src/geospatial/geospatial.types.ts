export interface GeographicPoint {
  type: 'Point';
  coordinates: [longitude: number, latitude: number];
}

export interface GeographicPolygon {
  type: 'Polygon';
  coordinates: [[longitude: number, latitude: number][]];
}

export interface GeographicBoundary {
  type: 'Feature';
  properties: { id: string; name: string };
  geometry: GeographicPolygon;
}

export interface GeographicRequestFeature {
  type: 'Feature';
  properties: { id: string; title: string; category: string; status: string };
  geometry: GeographicPoint;
}

export interface GeospatialMapData {
  organizationId: string;
  boundary: GeographicBoundary;
  requests: { type: 'FeatureCollection'; features: GeographicRequestFeature[] };
}

function validCoordinates(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Validate the narrow F024-compatible subset before an HTTP response is sent.
export function isGeospatialMapData(
  value: unknown,
  organizationId: string,
): value is GeospatialMapData {
  if (!isRecord(value)) return false;
  const boundary = value.boundary;
  if (!isRecord(boundary)) return false;
  const boundaryGeometry = boundary.geometry;
  const boundaryProperties = boundary.properties;
  if (!isRecord(boundaryGeometry) || !isRecord(boundaryProperties))
    return false;
  const rings = boundaryGeometry.coordinates;
  const ring: unknown = Array.isArray(rings) ? rings[0] : undefined;
  if (
    value.organizationId !== organizationId ||
    boundary.type !== 'Feature' ||
    boundaryGeometry.type !== 'Polygon' ||
    !Array.isArray(rings) ||
    rings.length !== 1 ||
    !Array.isArray(ring) ||
    ring.length < 4 ||
    !ring.every(validCoordinates) ||
    JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1]) ||
    typeof boundaryProperties.id !== 'string' ||
    !boundaryProperties.id ||
    typeof boundaryProperties.name !== 'string'
  )
    return false;
  const requests = value.requests;
  if (
    !isRecord(requests) ||
    requests.type !== 'FeatureCollection' ||
    !Array.isArray(requests.features)
  )
    return false;
  const ids = new Set<string>();
  for (const feature of requests.features as unknown[]) {
    if (!isRecord(feature)) return false;
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (!isRecord(geometry) || !isRecord(properties)) return false;
    if (
      feature.type !== 'Feature' ||
      geometry.type !== 'Point' ||
      !validCoordinates(geometry.coordinates) ||
      !(['id', 'title', 'category', 'status'] as const).every(
        (key) => typeof properties[key] === 'string' && properties[key].trim(),
      ) ||
      ids.has(properties.id as string)
    )
      return false;
    ids.add(properties.id as string);
  }
  return true;
}

export function projectGeospatialMapData(
  value: unknown,
  organizationId: string,
): GeospatialMapData {
  if (!isGeospatialMapData(value, organizationId))
    throw new Error('Invalid geospatial provider response');
  return {
    organizationId,
    boundary: {
      type: 'Feature',
      properties: {
        id: value.boundary.properties.id,
        name: value.boundary.properties.name,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          value.boundary.geometry.coordinates[0].map(([lon, lat]) => [
            lon,
            lat,
          ]),
        ],
      },
    },
    requests: {
      type: 'FeatureCollection',
      features: value.requests.features.map((feature) => ({
        type: 'Feature',
        properties: {
          id: feature.properties.id,
          title: feature.properties.title,
          category: feature.properties.category,
          status: feature.properties.status,
        },
        geometry: {
          type: 'Point',
          coordinates: [...feature.geometry.coordinates],
        },
      })),
    },
  };
}
