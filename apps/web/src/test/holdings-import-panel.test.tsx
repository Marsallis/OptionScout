import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldingsImportPanel } from '../components/HoldingsImportPanel';

const mocks = vi.hoisted(() => ({
  previewHoldingsCsvImport: vi.fn(),
  commitHoldingsCsvImport: vi.fn(),
}));

vi.mock('../api/client', () => ({
  previewHoldingsCsvImport: mocks.previewHoldingsCsvImport,
  commitHoldingsCsvImport: mocks.commitHoldingsCsvImport,
}));

const HASH = 'a'.repeat(64);

function previewFixture(tickerColumn = 'Ticker') {
  return {
    headers: ['Ticker', 'Name', 'Alt Symbol'],
    headerLine: 3,
    mapping: { Ticker: tickerColumn === 'Ticker' ? 'ticker' : 'ignore', Name: 'name', 'Alt Symbol': tickerColumn === 'Alt Symbol' ? 'ticker' : 'ignore' },
    rows: [
      { line: 4, rawTicker: 'AAPL', ticker: 'AAPL', name: 'Apple', sector: null, weight: null, assetClass: null, status: 'equity', reason: 'Equity holding.' },
      { line: 5, rawTicker: 'BRK/B', ticker: 'BRK.B', name: 'Berkshire', sector: null, weight: null, assetClass: null, status: 'equity', reason: 'Share-class symbol normalized from BRK/B.' },
      { line: 6, rawTicker: 'AB$C', ticker: null, name: 'Broken', sector: null, weight: null, assetClass: null, status: 'invalid', reason: 'Invalid ticker format.' },
      { line: 7, rawTicker: 'USD', ticker: null, name: 'Cash', sector: null, weight: null, assetClass: null, status: 'cash', reason: 'Cash or cash equivalent.' },
    ],
    rowsTruncated: false,
    uniqueEquityTickers: ['AAPL', 'BRK.B'],
    counts: { parsed: 4, equity: 2, duplicate: 0, invalid: 1, nonEquity: 0, cash: 1, ignored: 1, normalizedShareClass: 1 },
    detectedEffectiveDate: '2026-10-15',
    contentHash: HASH,
    truncated: false,
  };
}

describe('Holdings import panel', () => {
  beforeEach(() => {
    mocks.previewHoldingsCsvImport.mockReset().mockImplementation(async (_text: string, mapping?: { ticker?: string }) =>
      previewFixture(mapping?.ticker ?? 'Ticker'),
    );
    mocks.commitHoldingsCsvImport.mockReset().mockResolvedValue({
      universeId: 'u1',
      versionId: 'u1@v1',
      version: 1,
      unchanged: false,
      notice: 'Saved as immutable version v1.',
    });
  });

  it('shows row-level errors, requires a current validated preview and a date, and saves with the previewed hash', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<HoldingsImportPanel disabled={false} savedUniverses={[]} onSaved={onSaved} onNotice={vi.fn()} />);

    const save = screen.getByRole('button', { name: 'Save holdings version' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Where should this file be saved?' })).toHaveTextContent(
      'Create a new collection',
    );
    await user.type(screen.getByLabelText('Holdings CSV text'), 'Ticker,Name{enter}AAPL,Apple');
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Preview and validate' }));
    const table = await screen.findByRole('table', { name: 'Holdings preview rows' });
    // Issues first: invalid and cash rows with their line numbers and reasons; equities hidden in this filter.
    expect(within(table).getByText('AB$C')).toBeInTheDocument();
    expect(within(table).getByText('Invalid ticker format.')).toBeInTheDocument();
    expect(within(table).getByText('Cash or cash equivalent.')).toBeInTheDocument();
    expect(within(table).queryByText('Apple')).not.toBeInTheDocument();
    expect(screen.getByText(/2 unique equities/)).toBeInTheDocument();
    expect(screen.getByText(/1 share-class symbols normalized/)).toBeInTheDocument();
    expect(screen.getByLabelText('Holdings as-of date')).toHaveValue('2026-10-15');
    expect(save).toBeEnabled();

    // A mapping change invalidates the preview until it is validated again.
    await user.click(screen.getByRole('combobox', { name: 'Ticker column' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Alt Symbol' }));
    expect(screen.getByText(/changed since this preview/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Preview and validate' }));
    await waitFor(() => expect(save).toBeEnabled());
    expect(mocks.previewHoldingsCsvImport).toHaveBeenLastCalledWith(expect.any(String), { ticker: 'Alt Symbol' }, 'auto');

    // Clearing the date blocks saving.
    await user.clear(screen.getByLabelText('Holdings as-of date'));
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Holdings as-of date'), '2026-10-14');
    expect(save).toBeEnabled();
    expect(screen.getByText(/Saving records holdings as of 2026-10-14/)).toBeInTheDocument();
    expect(screen.getByText(/Earlier versions of this collection are not changed/)).toBeInTheDocument();

    await user.click(save);
    await waitFor(() => expect(mocks.commitHoldingsCsvImport).toHaveBeenCalledTimes(1));
    expect(mocks.commitHoldingsCsvImport.mock.calls[0]![0]).toMatchObject({
      contentHash: HASH,
      holdingsEffectiveDate: '2026-10-14',
      mapping: { ticker: 'Alt Symbol' },
      universeId: null,
    });
    expect(onSaved).toHaveBeenCalledWith('u1', 'Saved as immutable version v1.');
  });

  it('replaces the holdings date for each new file and keeps a same-file override', async () => {
    const user = userEvent.setup();
    mocks.previewHoldingsCsvImport.mockImplementation(async (text: string) => ({
      ...previewFixture(),
      detectedEffectiveDate: text.includes('FILE_B') ? '2026-10-16' : text.includes('NO_DATE') ? null : '2026-10-15',
    }));
    render(<HoldingsImportPanel disabled={false} savedUniverses={[]} onSaved={vi.fn()} onNotice={vi.fn()} />);
    const csv = screen.getByLabelText('Holdings CSV text');
    const preview = screen.getByRole('button', { name: 'Preview and validate' });
    const save = screen.getByRole('button', { name: 'Save holdings version' });

    await user.type(csv, 'FILE_A,Ticker');
    await user.click(preview);
    const date = await screen.findByLabelText('Holdings as-of date');
    await waitFor(() => expect(date).toHaveValue('2026-10-15'));
    expect(screen.getByText(/Saving records holdings as of 2026-10-15/)).toBeInTheDocument();

    await user.clear(date);
    await user.type(date, '2026-10-01');
    await user.click(preview);
    await waitFor(() => expect(date).toHaveValue('2026-10-01'));
    expect(screen.getByText(/The file suggested 2026-10-15/)).toBeInTheDocument();
    expect(screen.getByText(/Saving records holdings as of 2026-10-01/)).toBeInTheDocument();

    await user.clear(csv);
    expect(date).toHaveValue('');
    await user.type(csv, 'FILE_B,Ticker');
    expect(date).toHaveValue('');
    expect(screen.getByText(/changed since this preview/)).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.click(preview);
    await waitFor(() => expect(date).toHaveValue('2026-10-16'));
    expect(screen.getByText(/Saving records holdings as of 2026-10-16/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('2026-10-15')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('2026-10-01')).not.toBeInTheDocument();
  });

  it('requires an owner date when the new file has none', async () => {
    const user = userEvent.setup();
    mocks.previewHoldingsCsvImport.mockImplementation(async () => ({
      ...previewFixture(),
      detectedEffectiveDate: null,
    }));
    render(<HoldingsImportPanel disabled={false} savedUniverses={[]} onSaved={vi.fn()} onNotice={vi.fn()} />);
    const save = screen.getByRole('button', { name: 'Save holdings version' });
    await user.type(screen.getByLabelText('Holdings CSV text'), 'NO_DATE,Ticker');
    await user.click(screen.getByRole('button', { name: 'Preview and validate' }));
    const date = await screen.findByLabelText('Holdings as-of date');
    await waitFor(() => expect(screen.getByText(/No holdings date was detected in this file/)).toBeInTheDocument());
    expect(date).toHaveValue('');
    expect(save).toBeDisabled();
    await user.type(date, '2026-10-12');
    expect(save).toBeEnabled();
    expect(screen.getByText(/Saving records holdings as of 2026-10-12/)).toBeInTheDocument();
    expect(screen.getByText(/The file did not include one/)).toBeInTheDocument();
  });
});
