import dotenv from 'dotenv';
import path from 'node:path';

// Load server/.env first, then repo-root .env (first value wins).
// SKIP_DOTENV=1 gives tests a hermetic config (no real keys, no external calls).
if (process.env.SKIP_DOTENV !== '1') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
  dotenv.config({ path: path.resolve(process.cwd(), '../.env'), quiet: true });
}

const env = (k: string, d = '') => (process.env[k] ?? d).trim();

const provider = env('LLM_PROVIDER', 'gemini').toLowerCase();
const LLM_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  // gemini-2.5-* returns 404 for new API keys; 3.5-flash-lite gave correct tool calls in ~1.4 s in testing.
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash-lite' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};
const llmDefault = LLM_DEFAULTS[provider] ?? LLM_DEFAULTS.openai;

export const config = {
  /** Product / assistant name. Change APP_NAME in .env (and client/src/brand.ts) to rebrand. */
  appName: env('APP_NAME', 'ShopBuddy'),
  port: Number(env('PORT', '4000')),
  publicBaseUrl: env('PUBLIC_BASE_URL').replace(/\/$/, ''),
  llm: {
    provider,
    apiKey: env('LLM_API_KEY'),
    baseUrl: env('LLM_BASE_URL', llmDefault.baseUrl).replace(/\/$/, ''),
    model: env('LLM_MODEL', llmDefault.model),
    /** Shared secret Agora sends to our custom-LLM endpoint as `Authorization: Bearer <secret>`. */
    proxySecret: env('LLM_PROXY_SECRET'),
  },
  agora: {
    appId: env('AGORA_APP_ID'),
    appCertificate: env('AGORA_APP_CERTIFICATE'),
    customerId: env('AGORA_CUSTOMER_ID'),
    customerSecret: env('AGORA_CUSTOMER_SECRET'),
    apiBase: env('AGORA_API_BASE', 'https://api.agora.io/api/conversational-ai-agent/v2'),
    asrVendor: env('ASR_VENDOR', 'ares'),
    asrLanguage: env('ASR_LANGUAGE', 'en-IN'),
    asrJson: env('ASR_JSON'),
    sttApiKey: env('STT_API_KEY'),
  },
  murf: {
    apiKey: env('MURF_API_KEY'),
    voiceId: env('MURF_VOICE_ID', 'Anisha'),
    locale: env('MURF_LOCALE', 'en-IN'),
    /** Used when a reply is in Devanagari Hindi (lite voice mode). Anisha is listed for both en-IN and hi-IN in Murf's Falcon voice list. */
    hindiVoiceId: env('MURF_HINDI_VOICE_ID', env('MURF_VOICE_ID', 'Anisha')),
    hindiLocale: env('MURF_HINDI_LOCALE', 'hi-IN'),
    model: env('MURF_MODEL', 'FALCON'),
    wsUrl: env('MURF_WS_URL', 'wss://global.api.murf.ai/v1/speech/stream-input'),
    httpStreamUrl: env('MURF_HTTP_STREAM_URL', 'https://global.api.murf.ai/v1/speech/stream'),
  },
};

export function capabilities() {
  const a = config.agora;
  const agoraAuth = Boolean(a.customerId && a.customerSecret) || Boolean(a.appCertificate);
  return {
    llm: Boolean(config.llm.apiKey),
    llmProvider: config.llm.apiKey ? `${config.llm.provider}:${config.llm.model}` : 'rule-engine',
    murf: Boolean(config.murf.apiKey),
    agoraVoice: Boolean(a.appId && agoraAuth && config.murf.apiKey && config.publicBaseUrl),
    languages: {
      understanding: ['en', 'hi (Devanagari)', 'hinglish'],
      stt: {
        lite: ['en-IN', 'hi-IN'],
        agora: config.agora.asrJson ? 'custom (ASR_JSON)' : `${config.agora.asrVendor}:${config.agora.asrLanguage}`,
      },
      tts: config.murf.apiKey ? { vendor: 'murf', model: config.murf.model, default: `${config.murf.voiceId}/${config.murf.locale}`, hindi: `${config.murf.hindiVoiceId}/${config.murf.hindiLocale}` } : null,
      note: 'Agora voice replies are Roman-script Hinglish via the configured Murf locale; Devanagari replies use the hi-IN voice in lite mode. If TTS fails for a language the UI shows text only.',
    },
    missingForAgoraVoice: [
      !a.appId && 'AGORA_APP_ID',
      !agoraAuth && 'AGORA_CUSTOMER_ID+AGORA_CUSTOMER_SECRET (or AGORA_APP_CERTIFICATE)',
      !config.murf.apiKey && 'MURF_API_KEY',
      !config.publicBaseUrl && 'PUBLIC_BASE_URL',
    ].filter(Boolean),
  };
}
