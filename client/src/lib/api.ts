import { browserSessionDeps, SessionManager } from "./session";

export const apiBaseUrl = import.meta.env.VITE_API_URL ?? "/api";

// The app's one session, shared by the API client and the React tree.
export const session = new SessionManager(browserSessionDeps(apiBaseUrl));

// Mirrors the server's error shape: { error: { code, message, fields?, ...data } }
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;
  // Extra values some codes carry (for example linkToken).
  readonly data: Record<string, unknown>;

  constructor(status: number, body: { code?: string; message?: string; fields?: Record<string, string[]> } & Record<string, unknown>) {
    const { code, message, fields, ...data } = body;
    super(message ?? "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = code ?? "REQUEST_FAILED";
    this.fields = fields;
    this.data = data;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  // Send the access token (default true). Guests simply send none.
  auth?: boolean;
};

// Calls the API. When the access token is rejected, refreshes once (coordinated
// across tabs) and retries the request once.
export async function api<T>(path: string, options: RequestOptions = {}, manager: SessionManager = session): Promise<T> {
  const { auth = true } = options;
  const token = auth ? await manager.getAccessToken() : null;
  let response = await send(path, options, token);

  if (response.status === 401 && token) {
    const refreshed = await manager.refresh(token);
    if (refreshed) response = await send(path, options, refreshed.accessToken);
  }

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error ?? {});
  return body as T;
}

function send(path: string, options: RequestOptions, token: string | null) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
  });
}
