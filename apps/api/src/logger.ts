const SECRETISH = /Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function redactText(value: string): string {
  return value.replace(SECRETISH, '[redacted]');
}

export function logInfo(message: string): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  console.log(JSON.stringify({ level: 'info', message: redactText(message), time: new Date().toISOString() }));
}

export function logError(message: string): void {
  console.error(JSON.stringify({ level: 'error', message: redactText(message), time: new Date().toISOString() }));
}
