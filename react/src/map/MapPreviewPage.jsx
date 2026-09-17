import { useState } from 'react';
import { useTheme } from '../theme/useTheme.js';
import CityVUEMap from './CityVUEMap.jsx';
import { isInsideSyntheticBoundary, syntheticBoundary, syntheticRequests, toNeutralLocation } from './syntheticMapData.js';
import './mapPreview.css';

export default function MapPreviewPage() {
    const { theme } = useTheme();
    const [selectedId, setSelectedId] = useState('sample-101');
    const [clickedLocation, setClickedLocation] = useState(null);
    const selected = syntheticRequests.features.find((feature) => feature.properties.id === selectedId);
    const selectedLocation = selected ? toNeutralLocation(selected.geometry.coordinates) : null;
    const showLocation = (coordinates) => setClickedLocation(toNeutralLocation(coordinates));

    return <section className="map-preview" aria-labelledby="map-preview-heading">
        <div className="alert alert-info" role="status"><strong>Demonstration Mode — SYNTHETIC TEST DATA</strong><p className="mb-0 mt-1">This map is not connected to City GIS. Its boundary and request locations are fictional and are not authoritative for addresses, assets, or service eligibility.</p></div>
        <header className="map-preview-heading"><div><p className="text-uppercase fw-semibold text-primary small mb-1">CityVUE · Map preview</p><h1 id="map-preview-heading">Service requests in context</h1><p className="text-body-secondary mb-0">Explore a sample service area and fictional request locations without a GIS vendor connection.</p></div><span className="badge text-bg-secondary">Stakeholder preview</span></header>
        <div className="map-preview-grid">
            <div className="map-preview-panel"><h2 className="h5">Sample area map</h2><p className="small text-body-secondary">Drag to move, scroll or use the zoom controls. Select a point, or click anywhere to try a location. The list also works without the map.</p><CityVUEMap boundary={syntheticBoundary} requests={syntheticRequests} selectedId={selectedId} theme={theme} onSelect={setSelectedId} onLocationSelect={showLocation} /><p className="small text-body-secondary mb-0 mt-2">No external basemap or map tiles are loaded. The colored shape is a fictional service area.</p></div>
            <aside className="map-preview-panel" aria-label="Synthetic request information"><h2 className="h5">Sample requests</h2><ul className="map-request-list">{syntheticRequests.features.map((feature) => <li key={feature.properties.id}><button type="button" className={feature.properties.id === selectedId ? 'selected' : ''} aria-pressed={feature.properties.id === selectedId} onClick={() => setSelectedId(feature.properties.id)}><strong>{feature.properties.title}</strong><span>{feature.properties.category} · {feature.properties.status}</span></button></li>)}</ul>
                <section className="map-selection" aria-labelledby="map-selection-heading"><h3 className="h6" id="map-selection-heading">Selected sample request</h3><p className="fw-semibold mb-1">{selected.properties.title}</p><p className="mb-1">{selected.properties.category} · {selected.properties.status}</p><p className="mb-0">{isInsideSyntheticBoundary(selectedLocation) ? 'Inside' : 'Outside'} the fictional service area</p></section>
                {clickedLocation && <section className="map-selection mt-3" aria-live="polite" aria-label="Selected sample location"><h3 className="h6">Map click location</h3><p className="mb-1">Latitude {clickedLocation.latitude.toFixed(4)}, longitude {clickedLocation.longitude.toFixed(4)}</p><p className="mb-0">{isInsideSyntheticBoundary(clickedLocation) ? 'Inside' : 'Outside'} the fictional service area. This is only a visual demonstration, not eligibility validation.</p></section>}
            </aside>
        </div>
    </section>;
}
