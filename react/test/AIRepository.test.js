import { afterEach, expect, test, vi } from 'vitest';
import { loadAIWorkspace } from '../src/ai/aiRepository.js';
import { setStaffTokenProvider } from '../src/auth/tokenProvider.js';
import { readResidentIntakeConfig } from '../src/config/runtimeConfig.js';

vi.mock('../src/config/runtimeConfig.js', () => ({ readResidentIntakeConfig: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); setStaffTokenProvider(null); vi.clearAllMocks(); });

test('AI reads use authenticated CityVUE endpoints and skip models when disabled', async () => {
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled: true }, apiBaseUrl: 'http://localhost:3000/api/v1' });
    setStaffTokenProvider(async () => 'test-token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ enabled: false }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadAIWorkspace()).toEqual({ status: { enabled: false }, models: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/v1/ai/status', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }));
});

test('enabled metadata loads models with authentication and never submits a prompt', async () => {
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled: true }, apiBaseUrl: 'http://localhost:3000/api/v1' });
    setStaffTokenProvider(async () => 'test-token');
    const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ enabled: true }) })
        .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    expect((await loadAIWorkspace()).models).toEqual([]);
    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method, options.headers.Authorization]))
        .toEqual(['/ai/status', '/ai/models'].map((path) => ['http://localhost:3000/api/v1' + path, 'GET', 'Bearer test-token']));
});

test('absent Entra configuration fails before network access', async () => {
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled: false } });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(loadAIWorkspace()).rejects.toThrow('staff-authentication-required');
    expect(fetchMock).not.toHaveBeenCalled();
});

test('workspace can use the active MSAL token function before the global provider effect mounts', async () => {
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled: true }, apiBaseUrl: 'http://localhost:3000/api/v1' });
    setStaffTokenProvider(null);
    const getAccessToken = vi.fn().mockResolvedValue('active-account-token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ enabled: false }) });
    vi.stubGlobal('fetch', fetchMock);
    await loadAIWorkspace({ getAccessToken });
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer active-account-token');
});
