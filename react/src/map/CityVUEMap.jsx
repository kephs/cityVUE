import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

function mapStyle(boundary, requests, theme) {
    const dark = theme === 'dark';
    return {
        version: 8,
        sources: {
            boundary: { type: 'geojson', data: { type: 'FeatureCollection', features: [boundary] } },
            requests: { type: 'geojson', data: requests }
        },
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': dark ? '#14263c' : '#e8f1f7' } },
            { id: 'service-area', type: 'fill', source: 'boundary', paint: { 'fill-color': dark ? '#276a73' : '#89c5b4', 'fill-opacity': 0.62 } },
            { id: 'service-area-outline', type: 'line', source: 'boundary', paint: { 'line-color': dark ? '#82e2d2' : '#176b69', 'line-width': 3 } },
            { id: 'request-points', type: 'circle', source: 'requests', paint: {
                'circle-radius': 9,
                'circle-color': ['match', ['get', 'status'], 'New', '#0d6efd', 'In progress', '#bb6500', 'Resolved', '#258055', '#6c757d'],
                'circle-stroke-color': '#fff', 'circle-stroke-width': 2
            } },
            { id: 'selected-point', type: 'circle', source: 'requests', filter: ['==', ['get', 'id'], ''], paint: {
                'circle-radius': 16, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': dark ? '#fff' : '#102a50', 'circle-stroke-width': 3
            } }
        ]
    };
}

export default function CityVUEMap({ boundary, requests, selectedId, theme, onSelect, onLocationSelect }) {
    const container = useRef(null);
    const mapInstance = useRef(null);
    const callbacks = useRef({ onSelect, onLocationSelect });
    const [state, setState] = useState('loading');
    callbacks.current = { onSelect, onLocationSelect };

    useEffect(() => {
        let map;
        let resizeObserver;
        let loadTimeout;
        try {
            maplibregl.setWorkerUrl(workerUrl);
            map = new maplibregl.Map({
                container: container.current,
                style: mapStyle(boundary, requests, theme),
                center: [0.015, 0], zoom: 10, attributionControl: false,
                dragRotate: false, touchPitch: false
            });
            mapInstance.current = map;
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            loadTimeout = window.setTimeout(() => setState('error'), 8000);
            map.on('load', () => { window.clearTimeout(loadTimeout); setState('ready'); });
            map.on('error', () => { window.clearTimeout(loadTimeout); setState('error'); });
            map.on('click', 'request-points', (event) => {
                const id = event.features?.[0]?.properties?.id;
                if (id) callbacks.current.onSelect(id);
            });
            map.on('click', (event) => {
                if (map.queryRenderedFeatures(event.point, { layers: ['request-points'] }).length) return;
                callbacks.current.onLocationSelect([event.lngLat.lng, event.lngLat.lat]);
            });
            if (typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(() => map.resize());
                resizeObserver.observe(container.current);
            }
        } catch {
            setState('error');
        }
        return () => {
            window.clearTimeout(loadTimeout);
            resizeObserver?.disconnect();
            map?.remove();
            if (mapInstance.current === map) mapInstance.current = null;
        };
    }, [boundary, requests, theme]);

    useEffect(() => {
        const map = mapInstance.current;
        if (map?.isStyleLoaded()) map.setFilter('selected-point', ['==', ['get', 'id'], selectedId || '']);
    }, [selectedId, state]);

    return <div className="cityvue-map-frame">
        <div ref={container} className="cityvue-map-canvas" aria-hidden="true" />
        {state === 'loading' && <p className="cityvue-map-message" role="status">Loading synthetic map…</p>}
        {state === 'error' && <p className="cityvue-map-message" role="alert">The interactive map is unavailable. Use the sample request list beside it.</p>}
    </div>;
}
