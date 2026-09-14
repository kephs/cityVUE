import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '../src/theme/ThemeProvider.jsx';
import { createMsalInstance } from '../src/auth/msalConfig.js';
import { loadAIWorkspace } from '../src/ai/aiRepository.js';
import { quickActions, navigationGroups } from '../src/admin/adminPreviewData.js';

const chart = vi.hoisted(() => ({ Chart: vi.fn(function Chart() { this.destroy = vi.fn(); }) }));
vi.mock('chart.js/auto', () => ({ default: chart.Chart }));
vi.mock('../src/auth/msalConfig.js', () => ({ createMsalInstance: vi.fn(() => { throw Error('Admin preview initialized Entra'); }) }));
vi.mock('../src/ai/aiRepository.js', () => ({ loadAIWorkspace: vi.fn(() => { throw Error('Admin preview loaded AI'); }) }));
let router;
let fetchSpy;
let xhrSpy;
beforeAll(async () => {
    await import('../src/admin/AdminPreviewPage.jsx');
    window.history.replaceState({}, '', '/admin-preview');
    router = (await import('../src/app/router.jsx')).default;
});
beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('Admin preview network call'); });
    xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => { throw Error('Admin preview XHR'); });
});
afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(createMsalInstance).not.toHaveBeenCalled();
    expect(loadAIWorkspace).not.toHaveBeenCalled();
    vi.restoreAllMocks();
});
afterAll(() => router.dispose());
async function open() {
    await router.navigate('/admin-preview');
    render(<ThemeProvider><RouterProvider router={router} /></ThemeProvider>);
    await screen.findByRole('heading', { name: 'Welcome to the CityVUE Admin Portal' });
}

test('public admin preview renders with explicit demo and production-boundary notices', async () => {
    await open();
    expect(screen.getByText('Demonstration Mode')).toBeInTheDocument();
    expect(screen.getByText('Actual administrative access requires City authentication and appropriate permissions.')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Administrator (Demo)')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'City of Rockville — Rise Together' })).toHaveAttribute('src', '/branding/city-of-rockville-logo-circle.jpg');
    expect(screen.getByText('Admin Portal v0.1 (Preview)')).toBeInTheDocument();
});

test('sample metrics, activity, status and inactive AI overview render', async () => {
    await open();
    const metrics = screen.getByRole('region', { name: 'Sample platform metrics' });
    for (const value of ['1,842', '1,564', '278', '3']) expect(within(metrics).getByText(value)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    for (const name of ['Date & Time', 'Type', 'Details', 'User']) expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    expect(screen.getByText('Demo indicators — not live monitoring.')).toBeInTheDocument();
    expect(screen.getByText('Not Connected')).toBeInTheDocument();
    const ai = screen.getByRole('region', { name: 'AI Usage Overview' });
    expect(within(ai).getByText('Preview Mode')).toBeInTheDocument();
    expect(within(ai).getAllByText('0')).toHaveLength(3);
});

test('all quick actions open inert panels, preserve focus and never write storage or APIs', async () => {
    await open();
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Preview wrote data'); });
    for (const label of quickActions) {
        const button = screen.getByRole('button', { name: label });
        fireEvent.click(button);
        expect(screen.getByRole('heading', { name: label })).toHaveFocus();
        expect(screen.getByText(/This action is disabled in Demonstration Mode/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
        expect(button).toHaveFocus();
    }
    expect(storage).not.toHaveBeenCalled();
});

test('grouped navigation only changes local active state and opens information', async () => {
    await open();
    const nav = screen.getByRole('navigation', { name: 'Demo administration sections' });
    for (const [, items] of navigationGroups) for (const label of items) {
        const button = within(nav).getByRole('button', { name: label });
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-current', 'page');
        expect(router.state.location.pathname).toBe('/admin-preview');
    }
});

test('department chart uses sample values and accessible text when period changes', async () => {
    await open();
    expect(chart.Chart.mock.calls.at(-1)[1].data.datasets[0].data).toEqual([180, 95, 62, 48, 32]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sample chart period' }), { target: { value: 'Last 7 days (sample)' } });
    expect(chart.Chart.mock.calls.at(-1)[1].data.datasets[0].data).toEqual([42, 23, 16, 12, 8]);
    fireEvent.click(screen.getByText('View chart values'));
    expect(screen.getByText('Public Works')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
});

test('notifications, sidebar visibility and theme use accessible local controls', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Demo notifications' }));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toHaveFocus();
    const toggle = screen.getByRole('button', { name: /Portal navigation/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const before = document.documentElement.dataset.bsTheme;
    fireEvent.click(screen.getByRole('button', { name: /Switch to/ }));
    expect(document.documentElement.dataset.bsTheme).not.toBe(before);
    localStorage.clear();
});
