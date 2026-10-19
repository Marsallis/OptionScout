import { brokerageFailureMessage, TastytradeError } from './errors.js';
import { parseBrokerJson } from './decimals.js';

export const USER_AGENT = 'OptionScout/0.1.0';

export interface TokenResponse {
  status: number;
  text: string;
}

export interface TokenHttp {
  postToken(body: Record<string, string>): Promise<TokenResponse>;
}

export class TokenManager {
  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;
  private authFailed = false;

  constructor(
    private readonly http: TokenHttp,
    private readonly credentials: { clientId: string; clientSecret: string; refreshToken: string },
    private readonly now: () => number = () => Date.now(),
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  async getAccessToken(): Promise<string> {
    if (this.authFailed) {
      throw new TastytradeError(400, false, 'Brokerage credentials were rejected. They will not be retried.');
    }
    const skew = 60_000;
    if (this.cached && this.cached.expiresAt - skew > this.now()) {
      return this.cached.token;
    }
    if (!this.inflight) {
      this.inflight = this.exchange().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async exchange(): Promise<string> {
    const response = await this.http.postToken({
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refreshToken,
      client_secret: this.credentials.clientSecret,
      client_id: this.credentials.clientId,
      scope: 'read',
    });
    if (response.status === 400 || response.status === 401) {
      this.authFailed = true;
      throw new TastytradeError(response.status, false, 'Brokerage credentials were rejected.');
    }
    if (response.status !== 200) {
      throw new TastytradeError(response.status, response.status === 429 || response.status >= 500, brokerageFailureMessage(response.status));
    }
    let body: { access_token?: unknown; expires_in?: unknown };
    try {
      body = JSON.parse(response.text) as { access_token?: unknown; expires_in?: unknown };
    } catch {
      throw new TastytradeError(200, false, 'The brokerage token response was incomplete.');
    }
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new TastytradeError(200, false, 'The brokerage token response was incomplete.');
    }
    this.cached = { token: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}

export const ALLOWED_DXLINK_URLS = [
  'wss://tasty-openapi-ws.dxfeed.com/realtime',
  'wss://tasty-openapi-dxlink-md-ws.dxfeed.com/realtime',
] as const;

export function brokerageBaseUrl(environment: 'sandbox' | 'production'): string {
  return environment === 'sandbox' ? 'https://api.cert.tastyworks.com' : 'https://api.tastyworks.com';
}

export function assertReadOnlyPath(method: string, pathname: string): void {
  if (pathname.includes('/orders') || pathname.includes('/order-')) {
    throw new TastytradeError(403, false, 'Order routes are not available.');
  }
  if (method === 'POST' && pathname === '/oauth/token') {
    return;
  }
  if (method !== 'GET') {
    throw new TastytradeError(403, false, 'Only read requests are available.');
  }
  if (pathname === '/customers/me/accounts' || pathname === '/market-data/by-type' || pathname === '/api-quote-tokens') {
    return;
  }
  if (/^\/accounts\/[^/]+\/positions$/.test(pathname) || /^\/accounts\/[^/]+\/transactions$/.test(pathname)) {
    return;
  }
  if (/^\/instruments\/equity-options\/[^/]+$/.test(pathname) || /^\/instruments\/equities\/[^/]+$/.test(pathname)) {
    return;
  }
  if (/^\/option-chains\/[^/]+\/nested$/.test(pathname)) {
    return;
  }
  throw new TastytradeError(403, false, 'That brokerage route is not available.');
}

export type BrokerQuery = Record<string, string | string[]>;

export interface BrokerageReadClient {
  getJson(path: string, query?: BrokerQuery): Promise<unknown>;
}

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<{ status: number; text(): Promise<string> }>;

export class TastytradeClient implements BrokerageReadClient {
  readonly tokens: TokenManager;
  private readonly fetchImpl: FetchImpl;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly options: {
      baseUrl: string;
      credentials: { clientId: string; clientSecret: string; refreshToken: string };
      fetchImpl?: FetchImpl;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokens = new TokenManager(
      {
        postToken: (body) => this.send('POST', '/oauth/token', { body, auth: false }),
      },
      options.credentials,
    );
  }

  async getJson(path: string, query?: BrokerQuery): Promise<unknown> {
    const response = await this.send('GET', path, { query, auth: true });
    if (response.status !== 200) {
      throw new TastytradeError(response.status, response.status === 429 || response.status >= 500, brokerageFailureMessage(response.status));
    }
    return parseBrokerJson(response.text);
  }

  private async send(
    method: string,
    path: string,
    options: { query?: BrokerQuery; body?: Record<string, string>; auth: boolean },
  ): Promise<TokenResponse> {
    const pathname = path.split('?')[0] ?? path;
    assertReadOnlyPath(method, pathname);
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      };
      if (options.auth) {
        headers.Authorization = `Bearer ${await this.tokens.getAccessToken()}`;
      }
      if (options.body) {
        headers['Content-Type'] = 'application/json';
      }
      const url = new URL(path, this.options.baseUrl);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          url.searchParams.append(key, item);
        }
      }
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await response.text();
      if (response.status === 401 && options.auth && attempt === 1) {
        this.tokens.invalidate();
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await this.sleep(25 * attempt);
        continue;
      }
      return { status: response.status, text };
    }
    throw new TastytradeError(503, true, brokerageFailureMessage(503));
  }
}
