import { isInsideBoundary, toNeutralLocation } from './geospatialData.js';

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

export { toNeutralLocation };

// Presentation-only synthetic polygon check. Never use this for service eligibility.
export function isInsideSyntheticBoundary(location, boundary = syntheticBoundary) {
    return isInsideBoundary(location, boundary);
}
