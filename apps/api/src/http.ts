import type { Request } from 'express';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function assertLoopbackRequest(req: Request, requireOrigin: boolean): void {
  if (!LOOPBACK_HOSTS.has(req.hostname)) {
    throw new HttpError(403, 'This app only accepts loopback requests.');
  }
  if (!requireOrigin) {
    return;
  }
  const origin = req.get('origin');
  if (!origin) {
    throw new HttpError(403, 'A loopback Origin header is required.');
  }
  let hostname = '';
  try {
    hostname = new URL(origin).hostname;
  } catch {
    throw new HttpError(403, 'The Origin header is not a valid URL.');
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new HttpError(403, 'Cross-origin changes are refused.');
  }
}
