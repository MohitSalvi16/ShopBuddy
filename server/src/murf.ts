import type { Response } from 'express';
import { config } from './config.js';

/**
 * Direct Murf Falcon HTTP streaming TTS (used by "Lite voice" mode, when Agora is not configured).
 * In full Agora mode Murf is invoked by the Agora Conversational AI engine itself (tts.vendor = "murf").
 */
export async function streamTts(text: string, res: Response, voice?: { voiceId: string; locale: string }) {
  const upstream = await fetch(config.murf.httpStreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': config.murf.apiKey },
    body: JSON.stringify({
      text,
      voiceId: voice?.voiceId ?? config.murf.voiceId,
      model: config.murf.model,
      locale: voice?.locale ?? config.murf.locale,
      format: 'MP3',
      sampleRate: 24000,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`Murf TTS failed (${upstream.status}): ${detail.slice(0, 300)}`);
  }
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}
