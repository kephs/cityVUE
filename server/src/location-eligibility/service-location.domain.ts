import type { GeographicBoundary } from '../geospatial/geospatial.types.js';

export function validServicePoint(
  latitude: unknown,
  longitude: unknown,
): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

// F024 single closed Polygon ring. Boundary edges are included.
export function pointInServiceBoundary(
  latitude: number,
  longitude: number,
  boundary: GeographicBoundary,
): boolean {
  if (!validServicePoint(latitude, longitude)) return false;
  const ring = boundary.geometry.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i],
      previous = ring[j];
    if (!current || !previous) return false;
    const [x, y] = current;
    const [px, py] = previous;
    const cross = (longitude - px) * (y - py) - (latitude - py) * (x - px);
    if (
      Math.abs(cross) <= 1e-12 &&
      longitude >= Math.min(x, px) &&
      longitude <= Math.max(x, px) &&
      latitude >= Math.min(y, py) &&
      latitude <= Math.max(y, py)
    )
      return true;
    if (
      y > latitude !== py > latitude &&
      longitude < ((px - x) * (latitude - y)) / (py - y) + x
    )
      inside = !inside;
  }
  return inside;
}
