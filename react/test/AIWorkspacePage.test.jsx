import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    await screen.findByText(/AI is currently disabled/);
    expect(screen.getByRole('heading', { name: 'AI Workspace', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Your prompt' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('enabled foundation with zero models still cannot send or compose', async () => {
    loadAIWorkspace.mockResolvedValue({ status: { enabled: true, chatEnabled: false }, models: [] });
    render(<AIWorkspacePage />);
    await screen.findByText(/AI is currently disabled/);
    expect(screen.getByRole('option')).toHaveTextContent('City General AI (Unavailable)');
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
    await screen.findByText(/AI is currently disabled/);
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: false, account: null });
    view.rerender(<AIWorkspacePage />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('account changes discard old authorization and recheck server permission', async () => {
    const view = render(<AIWorkspacePage />);
    await screen.findByText(/AI is currently disabled/);
    loadAIWorkspace.mockRejectedValue({ status: 403 });
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: true, account: { homeAccountId: 'other' } });
    view.rerender(<AIWorkspacePage />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permission/));
});

test('shared navigation includes the protected AI route without granting access', () => {
    useAuth.mockReturnValue({ enabled: false, isAuthenticated: false });
    render(<MemoryRouter><PrimaryNavigation /></MemoryRouter>);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/', '/report', '/issues', '/dashboard', '/staff/ai']);
});

test('registered /staff/ai route renders through the actual application router', async () => {
    const { default: router } = await import('../src/app/router.jsx');
    const { RouterProvider } = await import('react-router-dom');
    await router.navigate('/staff/ai');
    const view = render(<RouterProvider router={router} />);
    await screen.findByText(/AI is currently disabled/);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    view.unmount();
    router.dispose();
});


test('workspace shows task examples, privacy, staff status, responsible use and City branding', async () => {
    render(<AIWorkspacePage />);
    await screen.findByText('AI is currently disabled');
    expect(screen.getByRole('heading', {name:'City AI Assistant (Staff)'})).toBeInTheDocument();
    for (const title of ['Get Drafts','Find Information','Explore Ideas','Responsible Use']) expect(screen.getByRole('heading',{name:title})).toBeInTheDocument();
    expect(screen.getByText('Authorized (Staff)')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getAllByText('Conversation history is not stored.')).toHaveLength(2);
    expect(screen.getByText(/AI can make mistakes/)).toBeInTheDocument();
    expect(screen.getByRole('img',{name:'City of Rockville — Rise Together'})).toHaveAttribute('src', '/branding/city-of-rockville-logo-circle.jpg');
});

test('example selection and new conversation only update temporary local preview', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<AIWorkspacePage />);
    await screen.findByText('AI is currently disabled');
    fireEvent.click(screen.getByRole('button',{name:/Draft a professional email response/}));
    expect(screen.getByRole('textbox',{name:'Your prompt'})).toHaveValue('Draft a professional email response');
    expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:/New Conversation/}));
    expect(screen.getByRole('textbox',{name:'Your prompt'})).toHaveValue('');
    expect(loadAIWorkspace).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
});

test('informational navigation opens accessible guidance and moves focus', async () => {
    render(<AIWorkspacePage />);
    await screen.findByText('AI is currently disabled');
    for (const label of ['User Guidelines','Data & Privacy','AI Governance','Help']) {
        fireEvent.click(screen.getByRole('button',{name:label}));
        expect(screen.getByRole('heading',{name:label})).toHaveFocus();
        expect(screen.getByRole('button',{name:label})).toHaveAttribute('aria-expanded','true');
    }
});

test.each(['/', '/report', '/issues', '/dashboard', '/staff/ai'])('shared navigation renders AI Workspace from %s with the correct active state', (path) => {
    render(<MemoryRouter initialEntries={[path]}><PrimaryNavigation isOpen /></MemoryRouter>);
    const link=screen.getByRole('link',{name:'AI Workspace'});
    expect(link).toHaveAttribute('href','/staff/ai');
    if(path==='/staff/ai') expect(link).toHaveAttribute('aria-current','page');
    else expect(link).not.toHaveAttribute('aria-current');
});

test('unexpected available model metadata cannot enable chat or disclose internal fields', async () => {
    loadAIWorkspace.mockResolvedValue({status:{enabled:true,chatEnabled:true},models:[{id:'test',displayName:'Approved test label',enabled:true,availability:'available',endpoint:'SECRET',apiKey:'SECRET'}]});
    render(<AIWorkspacePage />);
    await screen.findByText('AI is currently disabled');
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();
    expect(document.body).not.toHaveTextContent('SECRET');
});


test('workspace follows the existing shared theme provider and toggle', async () => {
    const { ThemeProvider } = await import('../src/theme/ThemeProvider.jsx');
    const { default: RealThemeToggle } = await vi.importActual('../src/components/theme/ThemeToggle.jsx');
    localStorage.clear();
    render(<ThemeProvider><RealThemeToggle /><AIWorkspacePage /></ThemeProvider>);
    await screen.findByText('AI is currently disabled');
    const before=document.documentElement.dataset.bsTheme;
    fireEvent.click(screen.getByRole('button',{name:/Switch to/}));
    expect(document.documentElement.dataset.bsTheme).not.toBe(before);
    expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();
    expect(screen.getByRole('img',{name:'City of Rockville — Rise Together'})).toBeInTheDocument();
    localStorage.clear();
});
