import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/useTheme.js';
import CityVUEMap from './CityVUEMap.jsx';
import { isInsideBoundary, toNeutralLocation, validateMapData } from './geospatialData.js';
import { createPreviewGeospatialRepository, PREVIEW_ORGANIZATION_ID } from './geospatialRepository.js';
import './mapPreview.css';

export default function MapPreviewPage({ repository: suppliedRepository, organizationId = PREVIEW_ORGANIZATION_ID }) {
    const auth = useAuth();
    const repository = useMemo(() => suppliedRepository ?? createPreviewGeospatialRepository(), [suppliedRepository]);
    if (repository.mode === 'api' && !auth.enabled) return <section><h1>Map preview</h1><p role="status">Map sign-in is not configured.</p></section>;
    if (repository.mode === 'api' && !auth.isAuthenticated) return <section><h1>Staff sign-in required</h1><p>Sign in to access map data.</p><button className="btn btn-primary" onClick={auth.signIn}>Sign in</button></section>;
    // Remount on identity/scope changes so no previous principal's data survives.
    const scopeKey = repository.mode === 'api' ? auth.account?.homeAccountId ?? 'authenticated' : organizationId;
    return <MapPreviewContent key={scopeKey} repository={repository} organizationId={organizationId} auth={auth} />;
}

function MapPreviewContent({ repository, organizationId, auth }) {
    const apiMode = repository.mode === 'api';
    const { theme } = useTheme();
    const [selectedId, setSelectedId] = useState(null);
    const [clickedLocation, setClickedLocation] = useState(null);
    const [data, setData] = useState(null);
    const [loadState, setLoadState] = useState('loading');
    const [revision, setRevision] = useState(0);
    const refresh = () => { setData(null); setClickedLocation(null); setSelectedId(null); setLoadState('loading'); setRevision(value => value + 1); };
    useEffect(() => {
        const controller = new AbortController();
        setLoadState('loading');
        setData(null);
        setClickedLocation(null);
        Promise.resolve().then(() => repository.loadMapData(apiMode ? undefined : organizationId, { signal: controller.signal }))
            .then(result => {
                const valid = validateMapData(result, apiMode ? result?.organizationId : organizationId);
                if (!controller.signal.aborted) {
                    setData(valid);
                    setSelectedId(valid.requests.features[0]?.properties.id ?? null);
                    setLoadState('ready');
                }
            })
            .catch(error => { if (!controller.signal.aborted) setLoadState(apiMode && error?.status === 401 ? 'authentication' : apiMode && error?.status === 403 ? 'denied' : 'error'); });
        return () => controller.abort();
    }, [repository, organizationId, apiMode, revision]);
    const selected = data?.requests.features.find((feature) => feature.properties.id === selectedId);
    const selectedLocation = selected ? toNeutralLocation(selected.geometry.coordinates) : null;
    const showLocation = (coordinates) => setClickedLocation(toNeutralLocation(coordinates));

    return <section className="map-preview" aria-labelledby="map-preview-heading">
        {!apiMode && <div className="alert alert-info" role="status"><strong>Demonstration Mode — SYNTHETIC TEST DATA</strong><p className="mb-0 mt-1">This map is not connected to City GIS. Its boundary and request locations are fictional and are not authoritative for addresses, assets, or service eligibility.</p></div>}
        <header className="map-preview-heading"><div><p className="text-uppercase fw-semibold text-primary small mb-1">CityVUE · Map preview</p><h1 id="map-preview-heading">Service requests in context</h1><p className="text-body-secondary mb-0">{apiMode ? 'View service area and request locations available to your account.' : 'Explore a sample service area and fictional request locations without a GIS vendor connection.'}</p></div><span className="badge text-bg-secondary">Stakeholder preview</span></header>
        {loadState === 'loading' && <p role="status">{apiMode ? 'Loading map data…' : 'Loading synthetic geographic data…'}</p>}
        {loadState === 'authentication' && <div><p role="alert">Your session is not available or has expired. Sign in again to continue.</p><button className="btn btn-primary" onClick={auth.signIn}>Sign in again</button></div>}
        {loadState === 'denied' && <p role="alert">You don't currently have access to this map data.</p>}
        {loadState === 'error' && <p role="alert">{apiMode ? 'Map data is temporarily unavailable.' : 'Sample geographic data is unavailable. The interactive preview cannot be shown right now.'}</p>}
        {loadState !== 'loading' && loadState !== 'authentication' && <button type="button" className="btn btn-outline-primary mb-3" onClick={refresh}>{loadState === 'ready' ? 'Refresh map data' : 'Retry'}</button>}
        {data && <div className="map-preview-grid">
            <div className="map-preview-panel"><h2 className="h5">{apiMode ? 'Service area map' : 'Sample area map'}</h2><p className="small text-body-secondary">Drag to move, scroll or use the zoom controls. Select a point, or click anywhere to try a location. The list also works without the map.</p><CityVUEMap demo={!apiMode} boundary={data.boundary} requests={data.requests} selectedId={selectedId} theme={theme} onSelect={setSelectedId} onLocationSelect={showLocation} /><p className="small text-body-secondary mb-0 mt-2">{apiMode ? 'This preview does not determine service eligibility. No external map tiles are loaded.' : 'No external basemap or map tiles are loaded. The colored shape is a fictional service area.'}</p></div>
            <aside className="map-preview-panel" aria-label={apiMode ? 'Request information' : 'Synthetic request information'}><h2 className="h5">{apiMode ? 'Requests' : 'Sample requests'}</h2><ul className="map-request-list">{data.requests.features.map((feature) => <li key={feature.properties.id}><button type="button" className={feature.properties.id === selectedId ? 'selected' : ''} aria-pressed={feature.properties.id === selectedId} onClick={() => setSelectedId(feature.properties.id)}><strong>{feature.properties.title}</strong><span>{feature.properties.category} · {feature.properties.status}</span></button></li>)}</ul>
                {selected && <section className="map-selection" aria-labelledby="map-selection-heading"><h3 className="h6" id="map-selection-heading">{apiMode ? 'Selected request' : 'Selected sample request'}</h3><p className="fw-semibold mb-1">{selected.properties.title}</p><p className="mb-1">{selected.properties.category} · {selected.properties.status}</p><p className="mb-0">{isInsideBoundary(selectedLocation, data.boundary) ? 'Inside' : 'Outside'} the {apiMode ? 'displayed' : 'fictional'} service area</p></section>}
                {clickedLocation && <section className="map-selection mt-3" aria-live="polite" aria-label="Selected sample location"><h3 className="h6">Map click location</h3><p className="mb-1">Latitude {clickedLocation.latitude.toFixed(4)}, longitude {clickedLocation.longitude.toFixed(4)}</p><p className="mb-0">{isInsideBoundary(clickedLocation, data.boundary) ? 'Inside' : 'Outside'} the {apiMode ? 'displayed' : 'fictional'} service area. This is only a visual demonstration, not eligibility validation.</p></section>}
            </aside>
        </div>}
    </section>;
}
