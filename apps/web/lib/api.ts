export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const csrf =
    typeof document === "undefined"
      ? undefined
      : document.cookie.match(/(?:^|; )mcpops_csrf=([^;]+)/)?.[1];
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (
    csrf &&
    init?.method &&
    !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())
  )
    headers.set("x-csrf-token", decodeURIComponent(csrf));
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    let body: {
      error?: { message?: string; code?: string };
      message?: string;
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* use status text */
    }
    throw new ApiError(
      body.error?.message ?? body.message ?? response.statusText ?? "Request failed",
      response.status,
      body.error?.code,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure";
}
