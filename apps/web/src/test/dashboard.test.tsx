import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_DISCLAIMER } from '@optionscout/shared';
import { App } from '../App';
import { brokerFixture, dashboardFixture, settingsFixture } from './fixtures';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('dashboard rendering', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/session')) return jsonResponse({ authenticated: false, ownerConfigured: false, expiresAt: null, csrfToken: null });
        if (url.endsWith('/api/dashboard')) return jsonResponse(dashboardFixture);
        if (url.endsWith('/api/broker')) return jsonResponse(brokerFixture);
        if (url.endsWith('/api/settings') && init?.method === 'PUT') {
          return jsonResponse({ ...settingsFixture, density: 'compact' });
        }
        if (url.endsWith('/api/settings')) return jsonResponse(settingsFixture);
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }),
    );
  });

  it('renders the overview with demo data labels', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'OptionScout' })).toBeInTheDocument();
    expect(screen.getByTestId('demo-banner')).toHaveTextContent('DEMO MODE');
    expect(screen.getByText(DEMO_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Estimated invested capital')).toBeInTheDocument();
    expect(screen.getByText('$17,190.00')).toBeInTheDocument();
    expect(screen.getByText('SPY')).toBeInTheDocument();
    expect(screen.getByText('GOOGL Jan 2028 160 call')).toBeInTheDocument();
    expect(screen.getAllByText('DEMO').length).toBeGreaterThan(3);
    expect(screen.queryByText(/live market data/i)).not.toBeInTheDocument();
  });

  it('keeps unfinished sections labeled as later work', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Find One Stock' }));
    expect(await screen.findByRole('heading', { name: 'Find One Stock' })).toBeInTheDocument();
    expect(screen.getAllByText(/Find LEAPS/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Sign In to Search' })).toBeInTheDocument();
    expect(screen.getByText(/Sign in required/i)).toBeInTheDocument();
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument();
  });
});
