const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function getEmpresaSlugFromPath(path: string) {
  const match = /^\/api\/empresas\/([^/?#]+)/.exec(String(path || ""));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function withAdminAuthorization(path: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Authorization") && typeof window !== "undefined") {
    const slug = getEmpresaSlugFromPath(path);
    const token = slug ? window.sessionStorage.getItem(`adminToken:${slug}`) : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  return {
    ...init,
    headers,
  };
}

async function handle(res: Response) {
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `Erro ${res.status}`);
  }
  return res.json();
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  // Evita cache de GET e reaproveita a sessao admin da empresa quando existir.
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...withAdminAuthorization(path, init),
  });
  return handle(res);
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const requestInit = withAdminAuthorization(path, init);
  const headers = new Headers(requestInit.headers || {});
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function apiPut<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const requestInit = withAdminAuthorization(path, init);
  const headers = new Headers(requestInit.headers || {});
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function apiPatch<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const requestInit = withAdminAuthorization(path, init);
  const headers = new Headers(requestInit.headers || {});
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...withAdminAuthorization(path, init),
    method: "DELETE",
  });
  return handle(res);
}
