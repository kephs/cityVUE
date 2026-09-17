// Only the Polygon boundary and Point request subset used by the preview is supported.
export function toNeutralLocation(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return null;
    const [longitude, latitude] = coordinates;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    return { latitude, longitude };
}

export function isInsideBoundary(location, boundary) {
    if (!location || !boundary?.geometry?.coordinates?.[0]) return false;
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

export function validateMapData(data, organizationId) {
    if (!data || data.organizationId !== organizationId || typeof organizationId !== 'string' || !organizationId.trim()) throw new Error('Invalid geographic data');
    const boundary = data.boundary;
    const ring = boundary?.geometry?.coordinates?.[0];
    if (boundary?.type !== 'Feature' || boundary.geometry?.type !== 'Polygon' ||
        !Array.isArray(boundary.geometry.coordinates) || boundary.geometry.coordinates.length !== 1 ||
        !Array.isArray(ring) || ring.length < 4 || !ring.every(toNeutralLocation) ||
        JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1]) ||
        typeof boundary.properties?.id !== 'string' || !boundary.properties.id ||
        typeof boundary.properties?.name !== 'string') throw new Error('Invalid geographic data');
    const requests = data.requests;
    if (requests?.type !== 'FeatureCollection' || !Array.isArray(requests.features)) throw new Error('Invalid geographic data');
    const ids = new Set();
    for (const feature of requests.features) {
        const props = feature?.properties;
        if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point' ||
            !toNeutralLocation(feature.geometry.coordinates) ||
            !props || !['id', 'title', 'category', 'status'].every(key => typeof props[key] === 'string' && props[key].trim()) ||
            ids.has(props.id)) throw new Error('Invalid geographic data');
        ids.add(props.id);
    }
    return data;
}
