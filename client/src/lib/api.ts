import type { Caps, Cart, LangPref, Order } from './types';

function newSessionId() {
  return 'vs_' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 24);
}

export const sessionId: string = (() => {
  try {
    const existing = localStorage.getItem('parakh.session') ?? localStorage.getItem('shoppilot.session') ?? localStorage.getItem('vaanicart.session');
    if (existing) return existing;
    const id = newSessionId();
    localStorage.setItem('parakh.session', id);
    return id;
  } catch {
    return newSessionId();
  }
})();

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId, ...(init.headers || {}) },
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && (body as any).error) || `HTTP ${res.status}`);
  return body as T;
}

export interface AgentCreds { appId: string; channel: string; uid: number; token: string; agentUid: number; agentId: string; status: string }

export const api = {
  config: () => req<Caps>('/api/config'),
  chat: (history: { role: 'user' | 'assistant'; content: string }[], language: LangPref = 'auto') =>
    req<{ reply: string; mode: 'llm' | 'rules'; lang: string; ttsLocale: string | null }>('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId, history, language }) }),
  startAgent: (language: LangPref = 'auto') => req<AgentCreds>('/api/agent/start', { method: 'POST', body: JSON.stringify({ sessionId, language }) }),
  stopAgent: () => req<{ stopped: boolean }>('/api/agent/stop', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  addToCart: (productId: string) => req<{ cart: Cart }>('/api/cart/items', { method: 'POST', body: JSON.stringify({ productId, quantity: 1 }) }),
  removeFromCart: (productId: string) => req<{ cart: Cart }>(`/api/cart/items/${productId}`, { method: 'DELETE' }),
  applyCoupon: (code: string) => req<{ cart: Cart }>('/api/cart/coupon', { method: 'POST', body: JSON.stringify({ code }) }),
  confirmOrder: (expectedTotal?: number) => req<{ ok: boolean; data: { status: string } }>('/api/orders', { method: 'POST', body: JSON.stringify({ confirmation: true, expectedTotal }) }),
  tool: (name: string, args: unknown) => req<{ ok: boolean; data?: unknown; error?: { message: string } }>(`/api/tools/${name}`, { method: 'POST', body: JSON.stringify({ args }) }),
  rateProduct: (productId: string, rating: number, comment?: string) => req<{ ok: boolean; data: { new_average: number } }>(`/api/products/${productId}/rating`, { method: 'POST', body: JSON.stringify({ rating, comment }) }),
  showReviews: (productId: string) => req<{ ok: boolean }>(`/api/tools/get_review_insights`, { method: 'POST', body: JSON.stringify({ args: { product_id: productId } }) }),
  orders: () => req<Order[]>('/api/orders'),
  tts: async (text: string): Promise<Blob> => {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `TTS HTTP ${res.status}`);
    return res.blob();
  },
};

export const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
