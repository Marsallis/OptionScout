import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { brokerFixture, dashboardFixture, settingsFixture } from './fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('independent startup loads', () => {
  beforeEach(() => {
    let brokerCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/session')) return jsonResponse({ authenticated: false, ownerConfigured: false, expiresAt: null, csrfToken: null });
        if (url.endsWith('/api/dashboard')) return jsonResponse(dashboardFixture);
        if (url.endsWith('/api/settings')) return jsonResponse(settingsFixture);
        if (url.endsWith('/api/broker')) {
          brokerCalls += 1;
          if (brokerCalls === 1) return jsonResponse({ error: 'Broker status failed.' }, 500);
          return jsonResponse(brokerFixture);
        }
        return jsonResponse({ error: 'Not found' }, 404);
      }),
    );
  });

  it('shows the demo book when broker status fails, then retries that section', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Broker & Data' }));
    expect(await screen.findByText('Broker status is unavailable.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Broker & Data' })).toBeInTheDocument();
  });
});
