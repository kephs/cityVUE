import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ResidentAlertBanner, { visibleAlerts } from '../src/alerts/ResidentAlertBanner.jsx';

const alert = { id: 'one', type: 'notice', severity: 'info', title: 'Water service update', message: 'Crews are working.', startsAt: '2020-01-01T00:00:00Z', publishedAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z', expiresAt: null, linkUrl: null };
afterEach(() => vi.useRealTimers());
test('empty response reserves no space', async () => { const { container } = render(<ResidentAlertBanner loadAlerts={async () => []} />); await act(async () => {}); expect(container).toBeEmptyDOMElement(); });
test('renders text, severity, timestamp and calm semantics without a link or image', async () => {
  render(<ResidentAlertBanner loadAlerts={async () => [alert]} />);
  expect(await screen.findByRole('heading', { name: alert.title })).toBeInTheDocument();
  expect(screen.getByText(alert.message)).toBeInTheDocument(); expect(screen.getByText('Information')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('multiple alerts retain severity labels and urgent announcement semantics', async () => {
  render(<ResidentAlertBanner loadAlerts={async () => [alert, { ...alert, id: 'two', severity: 'critical', title: 'Closure' }]} />);
  await screen.findByText('Closure'); expect(screen.getAllByRole('heading')).toHaveLength(2); expect(screen.getByRole('alert')).toHaveTextContent('Critical');
});
test('HTTPS link opens securely and external images are not requested', async () => {
  render(<ResidentAlertBanner loadAlerts={async () => [{ ...alert, linkUrl: 'https://example.com/details', linkLabel: 'Service updates', imageUrl: 'https://example.com/image.png' }]} />);
  const link = await screen.findByRole('link', { name: /Service updates/ }); expect(link).toHaveAttribute('rel', 'noopener noreferrer'); expect(link).toHaveAttribute('target', '_blank'); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('unsafe links are never rendered and text cannot inject markup', async () => {
  render(<ResidentAlertBanner loadAlerts={async () => [{ ...alert, message: '<img src=x onerror=alert(1)>', linkUrl: 'javascript:alert(1)' }]} />);
  await screen.findByText('<img src=x onerror=alert(1)>'); expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('defensive visibility rejects future, expired, inactive and malformed data', () => {
  for (const change of [{ startsAt: '2999-01-01T00:00:00Z' }, { expiresAt: '2020-01-02T00:00:00Z' }, { isActive: false }, { publishedAt: null }, { severity: 'unknown' }, { deactivatedAt: '2020-01-02T00:00:00Z' }]) expect(visibleAlerts([{ ...alert, ...change }])).toEqual([]);
});
test('expiration removes banner without a network response', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
  const { container } = render(<ResidentAlertBanner loadAlerts={async () => [{ ...alert, expiresAt: '2026-09-10T12:00:01Z' }]} />);
  await act(async () => {}); expect(screen.getByText(alert.title)).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(container).toBeEmptyDOMElement();
});
test('failed reads leave homepage empty', async () => {
  const load = vi.fn().mockRejectedValue(new Error('Unavailable')); const { container } = render(<ResidentAlertBanner loadAlerts={load} />);
  await waitFor(() => expect(load).toHaveBeenCalled()); expect(container).toBeEmptyDOMElement();
});
