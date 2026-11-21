import agoraToken from 'agora-token';
const { RtcTokenBuilder, RtcRole, ConvoAITokenBuilder } = agoraToken as any;
import crypto from 'node:crypto';
import { config } from './config.js';
import { greetingFor } from './agent.js';
import type { LangPref } from './lang.js';

const AGENT_UID = 1001;
const TOKEN_TTL = 3600;

function rtcToken(channel: string, uid: number) {
  const { appId, appCertificate } = config.agora;
  if (!appCertificate) return ''; // App in "testing mode" (no certificate) accepts empty token
  return RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channel, uid, RtcRole.PUBLISHER, TOKEN_TTL, TOKEN_TTL);
}

/** REST auth: Basic (Customer ID/Secret) if configured, else `agora token=` using a ConvoAI token. */
function authHeader(channel: string): { header: string; agentToken: string } {
  const a = config.agora;
  if (a.customerId && a.customerSecret) {
    return { header: 'Basic ' + Buffer.from(`${a.customerId}:${a.customerSecret}`).toString('base64'), agentToken: rtcToken(channel, AGENT_UID) };
  }
  const t = ConvoAITokenBuilder.buildToken(a.appId, a.appCertificate, channel, String(AGENT_UID), TOKEN_TTL, TOKEN_TTL);
  return { header: `agora token="${t}"`, agentToken: t };
}

function asrConfig(pref: LangPref) {
  const a = config.agora;
  if (a.asrJson) return JSON.parse(a.asrJson);
  if (a.sttApiKey && a.asrVendor === 'deepgram') {
    return { vendor: 'deepgram', params: { url: 'wss://api.deepgram.com/v1/listen', key: a.sttApiKey, model: 'nova-3', language: 'multi' } };
  }
  // Hindi speakers get Hindi recognition; English/Hinglish/Auto use the configured language (default en-IN).
  return { vendor: a.asrVendor, language: pref === 'hi' ? (process.env.ASR_LANGUAGE_HI || 'hi-IN') : a.asrLanguage, params: {} };
}

export interface VoiceSession { agentId: string; channel: string; sessionId: string }
const active = new Map<string, VoiceSession>(); // sessionId -> agent

export async function startAgent(sessionId: string, pref: LangPref = 'auto') {
  const prev = active.get(sessionId);
  if (prev) await stopAgent(sessionId).catch(() => {});

  const channel = `buddy-${crypto.randomBytes(4).toString('hex')}`;
  const userUid = 100000 + Math.floor(Math.random() * 800000);
  const { header, agentToken } = authHeader(channel);

  const body = {
    name: `buddy-${sessionId.slice(0, 8)}-${Date.now()}`,
    properties: {
      channel,
      token: agentToken,
      agent_rtc_uid: String(AGENT_UID),
      remote_rtc_uids: [String(userUid)],
      enable_string_uid: false,
      idle_timeout: 120,
      asr: asrConfig(pref),
      llm: {
        // Agora streams OpenAI-format chat completions requests to our backend, which runs the tool loop.
        url: `${config.publicBaseUrl}/api/llm/chat/completions?session=${encodeURIComponent(sessionId)}`,
        api_key: config.llm.proxySecret,
        vendor: 'custom',
        style: 'openai',
        system_messages: [],
        greeting_message: greetingFor(pref),
        failure_message: 'Maaf kijiye, ek technical dikkat aa gayi. Phir se boliye?',
        max_history: 16,
        params: { model: 'shopbuddy-agent' },
      },
      tts: {
        vendor: 'murf',
        params: {
          api_key: config.murf.apiKey,
          base_url: config.murf.wsUrl,
          voiceId: pref === 'hi' ? config.murf.hindiVoiceId : config.murf.voiceId,
          locale: pref === 'hi' ? config.murf.hindiLocale : config.murf.locale,
          rate: 0,
          pitch: 0,
          model: config.murf.model,
          sample_rate: 24000,
        },
      },
    },
  };

  const res = await fetch(`${config.agora.apiBase}/projects/${config.agora.appId}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: header }, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Agora join failed (${res.status}): ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  active.set(sessionId, { agentId: json.agent_id, channel, sessionId });
  console.log(`[agora] agent ${json.agent_id} joined ${channel} status=${json.status}`);

  return {
    appId: config.agora.appId, channel, uid: userUid, token: rtcToken(channel, userUid),
    agentUid: AGENT_UID, agentId: json.agent_id as string, status: json.status as string,
  };
}

export async function stopAgent(sessionId: string) {
  const s = active.get(sessionId);
  if (!s) return { stopped: false };
  active.delete(sessionId);
  const { header } = authHeader(s.channel);
  const res = await fetch(`${config.agora.apiBase}/projects/${config.agora.appId}/agents/${s.agentId}/leave`, { method: 'POST', headers: { Authorization: header } });
  if (!res.ok) console.warn(`[agora] leave ${s.agentId} -> ${res.status} ${await res.text()}`);
  return { stopped: res.ok, agentId: s.agentId };
}
