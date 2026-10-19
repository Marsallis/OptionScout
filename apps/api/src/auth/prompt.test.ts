import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readPipedLine } from './prompt.js';

describe('piped passphrase lines', () => {
  it('reads two lines that were written before the reader started', async () => {
    const input = Readable.from(['alpha-passphrase\nbeta-passphrase\n']);
    await expect(readPipedLine(input)).resolves.toBe('alpha-passphrase');
    await expect(readPipedLine(input)).resolves.toBe('beta-passphrase');
  });

  it('waits for a line that arrives after reading starts', async () => {
    const input = new Readable({ read() {} });
    const pending = readPipedLine(input);
    input.push('later-passphrase\n');
    await expect(pending).resolves.toBe('later-passphrase');
  });
});
