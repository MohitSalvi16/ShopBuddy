import type { Response } from 'express';

/** Server-Sent Events bus: pushes agent/tool state to the browser for a given shopping session. */
const clients = new Map<string, Set<Response>>();

export type UiEvent =
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; source: 'voice' | 'text' }
  | { type: 'status'; state: 'thinking' | 'idle' }
  | { type: 'tool'; name: string; args: unknown; ok: boolean; error?: string }
  | { type: 'products'; title: string; items: unknown[] }
  | { type: 'comparison'; items: unknown[] }
  | { type: 'deal'; title: string; result: unknown; items: unknown[] }
  | { type: 'critique'; critique: unknown }
  | { type: 'language'; lang: string; ttsLocale: string | null }
  | { type: 'focus'; product: unknown }
  | { type: 'cart'; cart: unknown }
  | { type: 'checkout'; summary: unknown }
  | { type: 'order'; order: unknown }
  | { type: 'agent'; state: string; detail?: string };

export function subscribe(sessionId: string, res: Response) {
  let set = clients.get(sessionId);
  if (!set) { set = new Set(); clients.set(sessionId, set); }
  set.add(res);
  return () => { set!.delete(res); if (!set!.size) clients.delete(sessionId); };
}

export function emit(sessionId: string, event: UiEvent) {
  const set = clients.get(sessionId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) res.write(payload);
}
