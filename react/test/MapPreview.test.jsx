import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import CityVUEMap from '../src/map/CityVUEMap.jsx';
import { setWorkerUrl } from 'maplibre-gl';
import MapPreviewPage from '../src/map/MapPreviewPage.jsx';
import { isInsideSyntheticBoundary, syntheticBoundary, syntheticRequests, toNeutralLocation } from '../src/map/syntheticMapData.js';
import { ThemeProvider } from '../src/theme/ThemeProvider.jsx';

const maps = vi.hoisted(() => ({ instances: [], fail: false }));
vi.mock('maplibre-gl', () => ({
    setWorkerUrl: vi.fn(),
    NavigationControl: class {},
    Map: class {
        constructor(options) { if (maps.fail) throw new Error('WebGL unavailable'); this.options = options; this.handlers = {}; this.remove = vi.fn(); this.resize = vi.fn(); this.setFilter = vi.fn(); maps.instances.push(this); }
        addControl() {}
        on(event, layerOrHandler, handler) { this.handlers[handler ? `${event}:${layerOrHandler}` : event] = handler || layerOrHandler; }
        queryRenderedFeatures() { return []; }
        isStyleLoaded() { return true; }
        emit(name, event = {}) { this.handlers[name]?.(event); }
    }
}));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/assets/mock-map-worker.js' }));

beforeEach(() => { maps.instances.length = 0; maps.fail = false; });
afterEach(() => vi.restoreAllMocks());

test('synthetic fixtures include inside and outside requests and use a neutral location shape', () => {
    expect(syntheticBoundary.geometry.type).toBe('Polygon');
    expect(syntheticRequests.features).toHaveLength(4);
    expect(syntheticRequests.features.map(feature => isInsideSyntheticBoundary(toNeutralLocation(feature.geometry.coordinates)))).toEqual([true, true, true, false]);
    expect(toNeutralLocation([0.1, -0.2])).toEqual({ latitude: -0.2, longitude: 0.1 });
    expect(toNeutralLocation([181, 0])).toBeNull();
});

test('MapLibre stays inside the map component, selects points and cleans up', () => {
    const onSelect = vi.fn(); const onLocationSelect = vi.fn();
    const view = render(<CityVUEMap boundary={syntheticBoundary} requests={syntheticRequests} selectedId="sample-101" theme="light" onSelect={onSelect} onLocationSelect={onLocationSelect} />);
    const map = maps.instances[0];
    expect(setWorkerUrl).toHaveBeenCalledWith('/assets/mock-map-worker.js');
    expect(map.options.style.sources.requests.data).toBe(syntheticRequests);
    expect(map.options.style.layers.map(layer => layer.id)).toContain('service-area');
    expect(JSON.stringify(map.options.style)).not.toMatch(/https?:|arcgis|rockville/i);
    act(() => map.emit('load'));
    expect(screen.queryByText('Loading synthetic map…')).not.toBeInTheDocument();
    act(() => map.emit('click:request-points', { features: [{ properties: { id: 'sample-102' } }] }));
    expect(onSelect).toHaveBeenCalledWith('sample-102');
    act(() => map.emit('click', { point: {}, lngLat: { lng: 0.02, lat: -0.01 } }));
    expect(onLocationSelect).toHaveBeenCalledWith([0.02, -0.01]);
    view.unmount();
    expect(map.remove).toHaveBeenCalledTimes(1);
});

test('a map runtime error leaves the textual alternative available', () => {
    render(<CityVUEMap boundary={syntheticBoundary} requests={syntheticRequests} selectedId="" theme="light" onSelect={vi.fn()} onLocationSelect={vi.fn()} />);
    act(() => maps.instances[0].emit('error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Use the sample request list');
});

test('an unresponsive map falls back instead of loading forever', () => {
    vi.useFakeTimers();
    try {
        const view = render(<CityVUEMap boundary={syntheticBoundary} requests={syntheticRequests} selectedId="" theme="light" onSelect={vi.fn()} onLocationSelect={vi.fn()} />);
        act(() => vi.advanceTimersByTime(8000));
        expect(screen.getByRole('alert')).toHaveTextContent('interactive map is unavailable');
        view.unmount();
    } finally { vi.useRealTimers(); }
});

test('preview keeps warnings, details and list controls available when WebGL fails', () => {
    maps.fail = true;
    render(<ThemeProvider><MapPreviewPage /></ThemeProvider>);
    expect(screen.getByText(/Demonstration Mode — SYNTHETIC TEST DATA/)).toBeInTheDocument();
    expect(screen.getByText(/not connected to City GIS/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('interactive map is unavailable');
    const park = screen.getByRole('button', { name: /Park path repair/ });
    fireEvent.click(park);
    expect(park).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Selected sample request' }).parentElement).toHaveTextContent('Park path repair');
});

test('preview route uses the existing app layout and navigation', async () => {
    maps.fail = true;
    window.history.replaceState({}, '', '/map-preview');
    const { default: router } = await import('../src/app/router.jsx');
    const { RouterProvider } = await import('react-router-dom');
    const view = render(<ThemeProvider><RouterProvider router={router} /></ThemeProvider>);
    expect(await screen.findByRole('heading', { name: 'Service requests in context' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Map Preview' })).toHaveAttribute('aria-current', 'page');
    view.unmount(); router.dispose();
});
