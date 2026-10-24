import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { brokerFixture, dashboardFixture, settingsFixture } from './fixtures';

const PASSPHRASE = 'correct horse battery staple';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('setup wizard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/session')) {
          return jsonResponse({ authenticated: false, ownerConfigured: false, expiresAt: null, csrfToken: null, publicSimulatedDemo: false });
        }
        if (url.endsWith('/api/dashboard')) return jsonResponse(dashboardFixture);
        if (url.endsWith('/api/broker')) return jsonResponse(brokerFixture);
        if (url.endsWith('/api/settings')) return jsonResponse(settingsFixture);
        if (url.endsWith('/api/owner/setup')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as { passphrase?: string };
          expect(body.passphrase).toBe(PASSPHRASE);
          return jsonResponse({
            authenticated: true,
            ownerConfigured: true,
            expiresAt: '2026-10-16T20:00:00.000Z',
            csrfToken: 'csrf-test',
            publicSimulatedDemo: false,
          });
        }
        if (url.includes('/api/market-data/watchlist-quotes')) {
          return jsonResponse({
            quotes: [
              {
                symbol: 'AAPL',
                last: 189.25,
                asOf: '2026-10-15T20:00:00.000Z',
                source: 'simulated',
                label: 'Simulated quote. Not a live price.',
                ordersEnabled: false,
              },
            ],
            refreshedAt: '2026-10-15T20:00:00.000Z',
            rateLimited: false,
          });
        }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }),
    );
  });

  it('walks from the simulated book to a status line without leaving the passphrase on screen', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const wizard = await screen.findByRole('region', { name: 'Setup wizard' });
    expect(within(wizard).getByText('Start on the simulated book')).toBeInTheDocument();
    await user.click(within(wizard).getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('New passphrase'), PASSPHRASE);
    await user.type(screen.getByLabelText('Repeat passphrase'), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: 'Save passphrase' }));
    expect(await screen.findByRole('heading', { name: 'Optional: a personal tastytrade grant' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'tastytrade developer portal' })).toHaveAttribute('href', 'https://developer.tastytrade.com/');
    expect(document.body.textContent).not.toContain(PASSPHRASE);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    const finished = await screen.findByRole('region', { name: 'Setup wizard' });
    expect(within(finished).getByRole('status')).toHaveTextContent('You are on the simulated book. Orders are off. Not connected.');
    expect(screen.getByRole('region', { name: 'Connection status' })).toHaveTextContent('Simulated. Not connected.');
    expect(screen.getByRole('table', { name: 'Payoff summary' })).toHaveTextContent('Max loss');
    expect(screen.getByRole('table', { name: 'Payoff summary' })).toHaveTextContent('Breakeven');
  });
});
