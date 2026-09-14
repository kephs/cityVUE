import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '../src/theme/ThemeProvider.jsx';
import { createMsalInstance } from '../src/auth/msalConfig.js';
import { readResidentIntakeConfig } from '../src/config/runtimeConfig.js';
import { loadAIWorkspace } from '../src/ai/aiRepository.js';

const identity = vi.hoisted(() => ({ account: null }));
vi.mock('../src/auth/msalConfig.js', () => ({ createMsalInstance: vi.fn(() => ({})) }));
vi.mock('../src/config/runtimeConfig.js', () => ({ readResidentIntakeConfig: vi.fn() }));
vi.mock('../src/ai/aiRepository.js', () => ({ loadAIWorkspace: vi.fn() }));
vi.mock('@azure/msal-react', () => ({
    MsalProvider: ({ children }) => children,
    useMsal: () => ({ accounts: [], instance: { getActiveAccount: () => identity.account } })
}));
let router;
beforeAll(async () => {
    window.history.replaceState({}, '', '/ai-preview');
    router = (await import('../src/app/router.jsx')).default;
});
beforeEach(() => {
    vi.clearAllMocks();
    identity.account = null;
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled: false } });
    loadAIWorkspace.mockRejectedValue({ status: 403 });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => router.dispose());
async function open(path) {
    await router.navigate(path);
    return render(<ThemeProvider><RouterProvider router={router} /></ThemeProvider>);
}

test('real preview route is anonymous, clearly labelled and isolated even when Entra is configured', async () => {
    identity.account = { homeAccountId: 'staff', name: 'Private staff identity' };
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled: true } });
    await open('/ai-preview');
    await screen.findByText('Demonstration Mode');
    expect(screen.getByText('Preview Only')).toBeInTheDocument();
    expect(screen.getByText('Not required for this preview')).toBeInTheDocument();
    expect(screen.getByRole('option')).toHaveTextContent('City General AI — Demo');
    expect(screen.queryByText('Authorized (Staff)')).not.toBeInTheDocument();
    expect(screen.queryByText('Private staff identity')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(createMsalInstance).not.toHaveBeenCalled();
    expect(readResidentIntakeConfig).not.toHaveBeenCalled();
    expect(loadAIWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'AI Workspace' })).toHaveAttribute('aria-current', 'page');
});

test('typing, examples and reset remain in memory without network, storage or logs', async () => {
    await open('/ai-preview');
    await screen.findByText('Demonstration Mode');
    const forbidden = () => { throw new Error('Preview attempted an external side effect'); };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden);
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(forbidden);
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(forbidden);
    const logSpies = ['log', 'info', 'warn', 'error', 'debug'].map(name => vi.spyOn(console, name).mockImplementation(forbidden));
    const prompt = screen.getByRole('textbox', { name: 'Your prompt' });
    expect(prompt).toBeEnabled();
    fireEvent.change(prompt, { target: { value: 'Private preview draft' } });
    expect(prompt).toHaveValue('Private preview draft');
    fireEvent.click(screen.getByRole('button', { name: /Draft a professional email response/ }));
    expect(prompt).toHaveValue('Draft a professional email response');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /New Conversation/ }));
    expect(prompt).toHaveValue('');
    for (const spy of [fetchSpy, xhrSpy, storageSpy, ...logSpies, loadAIWorkspace]) expect(spy).not.toHaveBeenCalled();
});

test('unmounting the preview discards the draft', async () => {
    const view = await open('/ai-preview');
    await screen.findByText('Demonstration Mode');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Temporary draft' } });
    view.unmount();
    await open('/ai-preview');
    expect(await screen.findByRole('textbox')).toHaveValue('');
});

test.each([false, true])('direct staff access remains guarded with Entra enabled=%s and never falls back to preview', async enabled => {
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled } });
    await open('/staff/ai');
    if (enabled) await screen.findByRole('heading', { name: 'Staff sign-in required' });
    else await screen.findByText(/Staff AI access is not enabled/);
    expect(screen.queryByText('Demonstration Mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(loadAIWorkspace).not.toHaveBeenCalled();
});

test('authenticated staff still requires server permission on the real workspace', async () => {
    identity.account = { homeAccountId: 'staff', name: 'Staff' };
    readResidentIntakeConfig.mockReturnValue({ entra: { enabled: true } });
    await open('/staff/ai');
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(loadAIWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Demonstration Mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
