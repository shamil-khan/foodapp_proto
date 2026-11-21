export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
  rawText: string;
}

export interface RequestOptions {
  token?: string;
  useCookies?: boolean;
  headers?: Record<string, string>;
}

/**
 * GoF Facade: Encapsulates live HTTP fetch calls, cookie jar persistence,
 * Bearer JWT headers, and JSON response parsing for smoke tests.
 */
export class ApiTestClient {
  private readonly baseUrl: string;
  private readonly cookieJar = new Map<string, string>();

  constructor(baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public clearCookies(): void {
    this.cookieJar.clear();
  }

  public async get<T = Record<string, unknown>>(
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  public async post<T = Record<string, unknown>>(
    path: string,
    payload?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, payload, options);
  }

  public async patch<T = Record<string, unknown>>(
    path: string,
    payload?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, payload, options);
  }

  public async put<T = Record<string, unknown>>(
    path: string,
    payload?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, payload, options);
  }

  public async delete<T = Record<string, unknown>>(
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  private async request<T>(
    method: string,
    path: string,
    payload?: unknown,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      ...options?.headers,
    };

    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options?.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (options?.useCookies && this.cookieJar.size > 0) {
      headers.Cookie = Array.from(this.cookieJar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });

    if (options?.useCookies) {
      this.captureCookies(res.headers);
    }

    const rawText = await res.text();
    let body = {} as T;
    if (rawText.length > 0) {
      try {
        body = JSON.parse(rawText) as T;
      } catch {
        body = {
          raw: rawText,
        } as T;
      }
    }

    return {
      status: res.status,
      headers: res.headers,
      body,
      rawText,
    };
  }

  private captureCookies(headers: Headers): void {
    const setCookies = headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const firstPart = raw.split(';')[0]?.trim();
      if (!firstPart) continue;
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx > 0) {
        const name = firstPart.slice(0, eqIdx);
        const value = firstPart.slice(eqIdx + 1);
        this.cookieJar.set(name, value);
      }
    }
  }
}

export async function loginPosStaff(
  client: ApiTestClient,
  credentials: {
    brandHandle: string;
    email: string;
    password: string;
    branchId?: string;
  },
): Promise<string> {
  const res = await client.post<{
    token: string;
  }>('/api/pos/auth/login', credentials);
  if (res.status !== 200 || !res.body.token) {
    throw new Error(`POS login failed (${res.status}): ${res.rawText}`);
  }
  return res.body.token;
}
