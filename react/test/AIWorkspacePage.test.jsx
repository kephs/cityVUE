import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import AIWorkspacePage from '../src/ai/AIWorkspacePage.jsx';
import StaffRouteGuard from '../src/auth/StaffRouteGuard.jsx';
import PrimaryNavigation from '../src/components/navigation/PrimaryNavigation.jsx';
import { useAuth } from '../src/auth/AuthContext.jsx';
import { loadAIWorkspace } from '../src/ai/aiRepository.js';

vi.mock('../src/auth/AuthContext.jsx', () => ({ useAuth: vi.fn() }));
vi.mock('../src/ai/aiRepository.js', () => ({ loadAIWorkspace: vi.fn() }));
vi.mock('../src/components/theme/ThemeToggle.jsx', () => ({ default: () => <button>Theme</button> }));
beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: true, account: { homeAccountId: 'employee' } });
    loadAIWorkspace.mockResolvedValue({ status: { enabled: false, chatEnabled: false }, models: [] });
});

test('staff route renders authorized disabled state and labelled inert controls', async () => {
    render(<StaffRouteGuard requireEntra><AIWorkspacePage /></StaffRouteGuard>);
    await screen.findByText(/The AI workspace is not enabled/);
    expect(screen.getByRole('heading', { name: 'CityVUE AI Workspace', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Your prompt' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('enabled foundation with zero models still cannot send or compose', async () => {
    loadAIWorkspace.mockResolvedValue({ status: { enabled: true, chatEnabled: false }, models: [] });
    render(<AIWorkspacePage />);
    await screen.findByText(/AI services are not connected/);
    expect(screen.getByRole('option')).toHaveTextContent('No models currently enabled');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('Entra-disabled legacy mode cannot render AI children or call API', () => {
    useAuth.mockReturnValue({ enabled: false, isAuthenticated: false });
    render(<StaffRouteGuard requireEntra><AIWorkspacePage /></StaffRouteGuard>);
    expect(screen.getByRole('status')).toHaveTextContent('Staff AI access is not enabled');
    expect(loadAIWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('anonymous staff route requires sign in without fetching metadata', () => {
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: false, signIn: vi.fn() });
    render(<StaffRouteGuard requireEntra><AIWorkspacePage /></StaffRouteGuard>);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(loadAIWorkspace).not.toHaveBeenCalled();
});

test.each([401, 403, 500])('API rejection %s renders safe state without composer', async (status) => {
    loadAIWorkspace.mockRejectedValue({ status, message: 'INTERNAL_SECRET' });
    render(<AIWorkspacePage />);
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('INTERNAL_SECRET');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('sign out removes previously authorized workspace immediately', async () => {
    const view = render(<AIWorkspacePage />);
    await screen.findByText(/The AI workspace is not enabled/);
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: false, account: null });
    view.rerender(<AIWorkspacePage />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('account changes discard old authorization and recheck server permission', async () => {
    const view = render(<AIWorkspacePage />);
    await screen.findByText(/The AI workspace is not enabled/);
    loadAIWorkspace.mockRejectedValue({ status: 403 });
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: true, account: { homeAccountId: 'other' } });
    view.rerender(<AIWorkspacePage />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permission/));
});

test('public navigation retains its existing links without an AI entry', () => {
    useAuth.mockReturnValue({ enabled: false, isAuthenticated: false });
    render(<MemoryRouter><PrimaryNavigation /></MemoryRouter>);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/', '/report', '/issues', '/dashboard']);
});

test('registered /staff/ai route renders through the actual application router', async () => {
    const { default: router } = await import('../src/app/router.jsx');
    const { RouterProvider } = await import('react-router-dom');
    await router.navigate('/staff/ai');
    const view = render(<RouterProvider router={router} />);
    await screen.findByText(/The AI workspace is not enabled/);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    view.unmount();
    router.dispose();
});
