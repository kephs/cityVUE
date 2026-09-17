// SYNTHETIC TEST DATA near 0°N, 0°E. These are fictional points, not addresses or City GIS data.
export const syntheticBoundary = {
    type: 'Feature',
    properties: { id: 'sample-service-area', name: 'Sample service area' },
    geometry: {
        type: 'Polygon',
        coordinates: [[[-0.07, -0.065], [0.07, -0.065], [0.07, 0.065], [-0.07, 0.065], [-0.07, -0.065]]]
    }
};

export const syntheticRequests = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { id: 'sample-101', title: 'Streetlight concern', category: 'Lighting', status: 'New' }, geometry: { type: 'Point', coordinates: [-0.035, 0.025] } },
        { type: 'Feature', properties: { id: 'sample-102', title: 'Park path repair', category: 'Parks', status: 'In progress' }, geometry: { type: 'Point', coordinates: [0.025, 0.035] } },
        { type: 'Feature', properties: { id: 'sample-103', title: 'Drainage concern', category: 'Streets', status: 'Resolved' }, geometry: { type: 'Point', coordinates: [0.04, -0.035] } },
        { type: 'Feature', properties: { id: 'sample-104', title: 'Sign inspection', category: 'Streets', status: 'New' }, geometry: { type: 'Point', coordinates: [0.105, 0.02] } }
    ]
};

export function toNeutralLocation(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length !== 2 ||
        !coordinates.every(Number.isFinite)) return null;
    const [longitude, latitude] = coordinates;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    return { latitude, longitude };
}

// Presentation-only synthetic polygon check. Never use this for service eligibility.
export function isInsideSyntheticBoundary(location, boundary = syntheticBoundary) {
    if (!location) return false;
    const ring = boundary.geometry.coordinates[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > location.latitude) !== (yj > location.latitude) &&
            location.longitude < (xj - xi) * (location.latitude - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
