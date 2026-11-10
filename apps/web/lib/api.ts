import { browserApiEndpoint } from './api-endpoint';

export const API_URL = browserApiEndpoint(process.env.NEXT_PUBLIC_API_URL);

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (typeof window !== 'undefined') {
    // Retira credenciales persistidas por versiones anteriores a la cookie HttpOnly.
    localStorage.removeItem('despacho_token');
    localStorage.removeItem('despacho_user');
  }
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (response.status === 401 && typeof window !== 'undefined') {
    clearAssistantSessionStorage();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
    throw new ApiError(message || `Error ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

export async function clearSession() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    clearAssistantSessionStorage();
    location.assign('/login');
  }
}

export async function downloadFromApi(path: string, fileName: string) {
  const blob = await blobFromApi(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function blobFromApi(path: string) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.message || `Error ${response.status}`, response.status);
  }
  return response.blob();
}

function clearAssistantSessionStorage() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('despacho_assistant:')) sessionStorage.removeItem(key);
    }
  } catch {
    // La sesión y la navegación no dependen de la disponibilidad del almacenamiento del navegador.
  }
}
