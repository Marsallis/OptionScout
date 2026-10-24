import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { brokerFixture, dashboardFixture, settingsFixture } from './fixtures';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('beginner desk appearance', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/session')) return jsonResponse({ authenticated: false, ownerConfigured: false, expiresAt: null, csrfToken: null });
        if (url.endsWith('/api/dashboard')) return jsonResponse(dashboardFixture);
        if (url.endsWith('/api/broker')) return jsonResponse(brokerFixture);
        if (url.endsWith('/api/settings')) return jsonResponse(settingsFixture);
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }),
    );
  });

  it('saves a colorway, opens the glossary, and switches to Pro', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Welcome guide' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Connection status' })).toHaveTextContent('Orders are off');
    expect(document.documentElement).toHaveAttribute('data-experience', 'beginner');

    await user.click(screen.getAllByRole('button', { name: 'Midnight Gold' })[0]!);
    expect(document.documentElement).toHaveAttribute('data-colorway', 'midnight');
    expect(localStorage.getItem('optionscout.colorway')).toBe('midnight');

    await user.click(screen.getByRole('button', { name: 'Glossary' }));
    const glossary = await screen.findByRole('dialog', { name: 'What these words mean' });
    expect(within(glossary).getByText('Put option')).toBeInTheDocument();
    expect(within(glossary).getByText('LEAPS')).toBeInTheDocument();

    await user.click(within(glossary).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'What these words mean' })).not.toBeInTheDocument();
    });
    await user.click(screen.getAllByRole('button', { name: 'Pro view' })[0]!);
    expect(document.documentElement).toHaveAttribute('data-experience', 'pro');
    expect(screen.queryByRole('region', { name: 'Welcome guide' })).not.toBeInTheDocument();
  });
});
