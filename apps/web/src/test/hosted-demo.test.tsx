import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { brokerFixture, dashboardFixture, settingsFixture, sessionFixture } from './fixtures';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('hosted public demo', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/session')) {
          return jsonResponse({ ...sessionFixture, authenticated: false, publicSimulatedDemo: true });
        }
        if (url.endsWith('/api/dashboard')) return jsonResponse(dashboardFixture);
        if (url.endsWith('/api/broker')) return jsonResponse(brokerFixture);
        if (url.endsWith('/api/settings')) return jsonResponse(settingsFixture);
        if (url.includes('/api/market-data/watchlist-quotes')) {
          return jsonResponse({ quotes: [], refreshedAt: '2026-10-15T20:00:00.000Z', rateLimited: false });
        }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }),
    );
  });

  it('points people to a local install and does not show login or grant fields', async () => {
    render(
      <MemoryRouter initialEntries={['/broker']}>
        <App />
      </MemoryRouter>,
    );
    const install = await screen.findByRole('link', {
      name: 'Want to connect your own broker? Download OptionScout and run it on your computer, where your login never leaves your machine.',
    });
    expect(install).toHaveAttribute('href', 'https://github.com/Marsallis/OptionScout/blob/main/README.md#try-it-on-one-screen');
    expect(screen.getByRole('heading', { name: 'Broker & Data' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/refresh token/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});
