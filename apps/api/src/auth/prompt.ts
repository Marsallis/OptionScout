import readline from 'node:readline';
import type { Readable } from 'node:stream';

const pendingLines = new WeakMap<Readable, string>();

/** Read one line from a non-interactive stream, including bytes already buffered. */
export function readPipedLine(input: Readable = process.stdin): Promise<string> {
  const pending = pendingLines.get(input) ?? '';
  const ready = pending.indexOf('\n');
  if (ready !== -1) {
    pendingLines.set(input, pending.slice(ready + 1));
    return Promise.resolve(pending.slice(0, ready).replace(/\r$/, ''));
  }

  return new Promise((resolve) => {
    let buffer = pending;
    const finish = (line: string, rest: string) => {
      input.pause();
      input.off('data', onData);
      input.off('end', onEnd);
      pendingLines.set(input, rest);
      resolve(line);
    };
    const onData = (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        return;
      }
      finish(buffer.slice(0, newline).replace(/\r$/, ''), buffer.slice(newline + 1));
    };
    const onEnd = () => {
      finish(buffer.replace(/\r$/, ''), '');
    };
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

export async function readPassphrase(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return readPipedLine(process.stdin);
  }

  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let result = '';
  await new Promise<void>((resolve) => {
    const onData = (chunk: string) => {
      if (chunk === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      }
      if (chunk === '\r' || chunk === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve();
        return;
      }
      if (chunk === '\u007f' || chunk === '\b') {
        result = result.slice(0, -1);
        return;
      }
      result += chunk;
    };
    stdin.on('data', onData);
  });
  return result;
}
