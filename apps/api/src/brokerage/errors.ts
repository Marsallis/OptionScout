export class TastytradeError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'TastytradeError';
  }
}

export class SyncInputError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = 'SyncInputError';
  }
}

export class ScheduledSyncDisabledError extends Error {
  constructor() {
    super('Automatic scheduled synchronization is disabled.');
    this.name = 'ScheduledSyncDisabledError';
  }
}

export function brokerageFailureMessage(status: number): string {
  if (status === 401) {
    return 'The brokerage session was rejected.';
  }
  if (status === 403) {
    return 'The brokerage refused this read.';
  }
  if (status === 429) {
    return 'The brokerage rate limit was reached. Try again later.';
  }
  if (status >= 500) {
    return 'The brokerage is temporarily unavailable.';
  }
  return 'The brokerage request failed.';
}
