import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import CityVUEMap from '../src/map/CityVUEMap.jsx';
import { setWorkerUrl } from 'maplibre-gl';
import MapPreviewPage from '../src/map/MapPreviewPage.jsx';
import { isInsideSyntheticBoundary, syntheticBoundary, syntheticRequests, toNeutralLocation } from '../src/map/syntheticMapData.js';
import { validateMapData } from '../src/map/geospatialData.js';
import { createPreviewGeospatialRepository, createSyntheticGeospatialRepository, PREVIEW_ORGANIZATION_ID } from '../src/map/geospatialRepository.js';
import { ThemeProvider } from '../src/theme/ThemeProvider.jsx';
import { AuthRoot } from '../src/auth/AuthContext.jsx';

const maps = vi.hoisted(() => ({ instances: [], fail: false }));
const auth = vi.hoisted(() => ({ enabled: true, isAuthenticated: true, account: { homeAccountId: 'fictional-account' }, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('../src/auth/AuthContext.jsx', async importOriginal => { const actual = await importOriginal(); return { ...actual, AuthRoot: vi.fn(actual.AuthRoot), useAuth: () => auth }; });
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

beforeEach(() => { maps.instances.length = 0; maps.fail = false; auth.enabled = true; auth.isAuthenticated = true; auth.account = { homeAccountId: 'fictional-account' }; auth.signIn.mockClear(); auth.signOut.mockClear(); });
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

test('preview keeps warnings, details and list controls available when WebGL fails', async () => {
    maps.fail = true;
    render(<ThemeProvider><MapPreviewPage /></ThemeProvider>);
    expect(screen.getByText(/Demonstration Mode — SYNTHETIC TEST DATA/)).toBeInTheDocument();
    expect(screen.getByText(/not connected to City GIS/)).toBeInTheDocument();
    expect(await screen.findByText(/interactive map is unavailable/)).toBeInTheDocument();
    const park = screen.getByRole('button', { name: /Park path repair/ });
    fireEvent.click(park);
    expect(park).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Selected sample request' }).parentElement).toHaveTextContent('Park path repair');
});

test('synthetic provider scopes each snapshot to one organization and validates the neutral shape', async () => {
    const first = createSyntheticGeospatialRepository({ organizationId: PREVIEW_ORGANIZATION_ID, boundary: syntheticBoundary, requests: syntheticRequests });
    const secondId = '20000000-0000-4000-8000-000000000002';
    const second = createSyntheticGeospatialRepository({ organizationId: secondId, boundary: syntheticBoundary, requests: { type: 'FeatureCollection', features: [syntheticRequests.features[3]] } });
    const a = await first.loadMapData(PREVIEW_ORGANIZATION_ID);
    expect(a.requests.features).toHaveLength(4);
    expect((await second.loadMapData(secondId)).requests.features).toHaveLength(1);
    await expect(first.loadMapData(secondId)).rejects.toThrow();
    await expect(second.loadMapData(PREVIEW_ORGANIZATION_ID)).rejects.toThrow();
    await expect(first.loadMapData('')).rejects.toThrow();
    a.requests.features[0].properties.title = 'Changed';
    expect((await first.loadMapData(PREVIEW_ORGANIZATION_ID)).requests.features[0].properties.title).toBe('Streetlight concern');
    expect(() => validateMapData({ ...a, organizationId: secondId }, PREVIEW_ORGANIZATION_ID)).toThrow();
    expect(() => validateMapData({ ...a, requests: { type: 'FeatureCollection', features: [{ ...syntheticRequests.features[0], geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] } }, PREVIEW_ORGANIZATION_ID)).toThrow();
});

test('synthetic preview provider is unavailable outside development mode', async () => {
    vi.stubEnv('DEV', false);
    try {
        await expect(createPreviewGeospatialRepository().loadMapData(PREVIEW_ORGANIZATION_ID)).rejects.toThrow('unavailable');
    } finally { vi.unstubAllEnvs(); }
});

test('preview loads through the repository and handles unavailable or invalid data safely', async () => {
    const deferred = {};
    const repository = { loadMapData: vi.fn(() => new Promise((resolve, reject) => { deferred.resolve = resolve; deferred.reject = reject; })) };
    const view = render(<ThemeProvider><MapPreviewPage repository={repository} /></ThemeProvider>);
    expect(screen.getByText('Loading synthetic geographic data…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Streetlight concern/ })).not.toBeInTheDocument();
    await act(async () => {});
    expect(repository.loadMapData).toHaveBeenCalledWith(PREVIEW_ORGANIZATION_ID, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await act(async () => deferred.resolve(await createSyntheticGeospatialRepository({ organizationId: PREVIEW_ORGANIZATION_ID, boundary: syntheticBoundary, requests: syntheticRequests }).loadMapData(PREVIEW_ORGANIZATION_ID)));
    expect(screen.getAllByRole('button', { name: /Streetlight concern/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Sign inspection/ }));
    expect(screen.getByRole('heading', { name: 'Selected sample request' }).parentElement).toHaveTextContent('Outside');
    act(() => maps.instances[0].emit('click', { point: {}, lngLat: { lng: 0.02, lat: -0.01 } }));
    expect(screen.getByLabelText('Selected sample location')).toHaveTextContent('Inside');
    view.unmount();

    const failed = render(<ThemeProvider><MapPreviewPage repository={{ loadMapData: async () => { throw new Error('private provider detail'); } }} /></ThemeProvider>);
    expect(await screen.findByText(/Sample geographic data is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument();
    failed.unmount();
    render(<ThemeProvider><MapPreviewPage repository={{ loadMapData: async () => ({ organizationId: PREVIEW_ORGANIZATION_ID, boundary: syntheticBoundary, requests: { type: 'FeatureCollection', features: [{ ...syntheticRequests.features[0], geometry: { type: 'Point', coordinates: [999, 0] } }] } }) }} /></ThemeProvider>);
    expect(await screen.findByText(/Sample geographic data is unavailable/)).toBeInTheDocument();
});

test('preview route uses the existing app layout and navigation', async () => {
    AuthRoot.mockClear();
    maps.fail = true;
    window.history.replaceState({}, '', '/map-preview');
    const { default: router } = await import('../src/app/router.jsx');
    const { RouterProvider } = await import('react-router-dom');
    const view = render(<ThemeProvider><RouterProvider router={router} /></ThemeProvider>);
    expect(await screen.findByRole('heading', { name: 'Service requests in context' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Map Preview' })).toHaveAttribute('aria-current', 'page');
    expect(AuthRoot).toHaveBeenCalled();
    view.unmount(); router.dispose();
});

const apiEnvironment = { DEV: true, VITE_CITYVUE_DATA_SOURCE: 'api', VITE_CITYVUE_API_BASE_URL: 'http://localhost:3000/api/v1' };
function apiData() {
    return structuredClone({ organizationId: 'server-owned-organization', boundary: syntheticBoundary, requests: {
        type: 'FeatureCollection', features: [{ ...syntheticRequests.features[0], properties: { ...syntheticRequests.features[0].properties, id: 'protected-1', title: 'Protected request' } }]
    } });
}
function apiRepository(fetchImplementation, options = {}) {
    return createPreviewGeospatialRepository({ environment: apiEnvironment, fetchImplementation, getAccessToken: async () => 'fictional-test-token', ...options });
}
function reply(status, body = {}) { return { ok: status === 200, status, headers: new Headers(), json: async () => body }; }
function renderApi(repository) { return render(<ThemeProvider><MapPreviewPage repository={repository} organizationId="untrusted-browser-hint" /></ThemeProvider>); }

test('API mode authenticates the protected request without a browser Organization hint', async () => {
    const fetcher = vi.fn(async () => reply(200, apiData()));
    const repository = apiRepository(fetcher);
    renderApi(repository);
    expect(await screen.findByRole('button', { name: /Protected request/ })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith('http://localhost:3000/api/v1/geospatial', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer fictional-test-token' }, signal: expect.any(AbortSignal) }));
    expect(maps.instances[0].options.style.sources.boundary.data.features[0].geometry.type).toBe('Polygon');
    expect(maps.instances[0].options.style.sources.requests.data.features[0].properties.title).toBe('Protected request');
    expect(screen.queryByText(/SYNTHETIC TEST DATA/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Streetlight concern/ })).not.toBeInTheDocument();
});

test('API loading exposes an accessible status and no fixture data', async () => {
    let resolve;
    renderApi(apiRepository(() => new Promise(done => { resolve = done; })));
    expect(screen.getByText('Loading map data…')).toHaveAttribute('role', 'status');
    expect(maps.instances).toHaveLength(0);
    await act(async () => {});
    await act(async () => resolve(reply(200, apiData())));
    expect(screen.getByRole('button', { name: /Protected request/ })).toBeInTheDocument();
});

test.each([401, 403, 500])('API HTTP %s is safe, distinct and never falls back to fixtures', async status => {
    renderApi(apiRepository(async () => reply(status, { message: 'private-server-token-detail' })));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(status === 401 ? 'Your session is not available' : status === 403 ? "You don't currently have access" : 'Map data is temporarily unavailable');
    expect(document.body.textContent).not.toContain('private-server-token-detail');
    expect(maps.instances).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Streetlight concern/ })).not.toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
    if (status === 401) { fireEvent.click(screen.getByRole('button', { name: 'Sign in again' })); expect(auth.signIn).toHaveBeenCalledTimes(1); }
    else expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
});

test('API network failure is sanitized and retry recovers', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('private-network-details')).mockResolvedValueOnce(reply(200, apiData()));
    renderApi(apiRepository(fetcher));
    expect(await screen.findByRole('alert')).toHaveTextContent('Map data is temporarily unavailable');
    expect(document.body.textContent).not.toContain('private-network-details');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Protected request/ })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
});

test('API timeout fails closed', async () => {
    const fetcher = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout detail')), { once: true }));
    renderApi(apiRepository(fetcher, { timeoutMs: 5 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Map data is temporarily unavailable');
    expect(maps.instances).toHaveLength(0);
});

test.each(['missing', 'geometry', 'coordinates', 'json'])('API rejects malformed %s data before rendering', async kind => {
    const data = apiData();
    if (kind === 'missing') delete data.organizationId;
    if (kind === 'geometry') data.boundary.geometry.type = 'MultiPolygon';
    if (kind === 'coordinates') data.requests.features[0].geometry.coordinates = [999, 0];
    const response = reply(200, data);
    if (kind === 'json') response.json = async () => { throw new Error('invalid JSON private detail'); };
    renderApi(apiRepository(async () => response));
    expect(await screen.findByRole('alert')).toHaveTextContent('Map data is temporarily unavailable');
    expect(maps.instances).toHaveLength(0);
});

test('subsequent 403 clears protected map and selection without logout or demo fallback', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(200, apiData())).mockResolvedValueOnce(reply(403));
    renderApi(apiRepository(fetcher));
    const selected = await screen.findByRole('button', { name: /Protected request/ });
    fireEvent.click(selected);
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    const map = maps.instances[0];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh map data' }));
    expect(screen.queryByRole('button', { name: /Protected request/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't currently have access");
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.queryByText(/Streetlight concern/)).not.toBeInTheDocument();
});

test.each(['signed-out', 'unconfigured'])('API %s never requests protected or demo data', async state => {
    auth.isAuthenticated = state !== 'signed-out'; auth.enabled = state !== 'unconfigured';
    const fetcher = vi.fn(); renderApi(apiRepository(fetcher));
    await act(async () => {});
    expect(fetcher).not.toHaveBeenCalled(); expect(maps.instances).toHaveLength(0);
    if (state === 'signed-out') { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); expect(auth.signIn).toHaveBeenCalledTimes(1); }
    else expect(screen.getByRole('status')).toHaveTextContent('Map sign-in is not configured');
});

test('account switch removes data and ignores a pending response from the previous account', async () => {
    let finishOld;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValueOnce(reply(403));
    const repository = apiRepository(fetcher); const view = renderApi(repository);
    await act(async () => {});
    auth.account = { homeAccountId: 'different-fictional-account' };
    view.rerender(<ThemeProvider><MapPreviewPage repository={repository} /></ThemeProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't currently have access");
    await act(async () => finishOld(reply(200, apiData())));
    expect(screen.queryByRole('button', { name: /Protected request/ })).not.toBeInTheDocument();
    expect(maps.instances).toHaveLength(0);
});

test('sign-out unmounts already rendered protected data immediately', async () => {
    const repository = apiRepository(async () => reply(200, apiData()));
    const view = renderApi(repository);
    expect(await screen.findByRole('button', { name: /Protected request/ })).toBeInTheDocument();
    const map = maps.instances[0];
    auth.isAuthenticated = false;
    view.rerender(<ThemeProvider><MapPreviewPage repository={repository} /></ThemeProvider>);
    expect(screen.getByRole('heading', { name: 'Staff sign-in required' })).toBeInTheDocument();
    expect(screen.queryByText('Protected request')).not.toBeInTheDocument();
    expect(map.remove).toHaveBeenCalledTimes(1);
});

test('theme recreation reapplies the selected map point after the new style loads', () => {
    const props = { boundary: syntheticBoundary, requests: syntheticRequests, selectedId: 'sample-102', onSelect: vi.fn(), onLocationSelect: vi.fn() };
    const view = render(<CityVUEMap {...props} theme="dark" />);
    act(() => maps.instances[0].emit('load'));
    view.rerender(<CityVUEMap {...props} theme="light" />);
    const replacement = maps.instances[1];
    expect(screen.getByText('Loading synthetic map…')).toBeInTheDocument();
    act(() => replacement.emit('load'));
    expect(replacement.setFilter).toHaveBeenCalledWith('selected-point', ['==', ['get', 'id'], 'sample-102']);
    expect(screen.queryByText('Loading synthetic map…')).not.toBeInTheDocument();
});
