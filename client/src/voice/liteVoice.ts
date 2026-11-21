import { api } from '../lib/api';
import { useStore } from '../store';

/* Minimal typing for the Web Speech API (Chrome/Edge). */
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null;
};
const SRCtor: (new () => SR) | undefined = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
export const liteSupported = Boolean(SRCtor);

/**
 * Lite voice mode (no Agora credentials needed): browser speech recognition -> /api/chat (same agent + tools)
 * -> Murf Falcon TTS via /api/tts. Hands-free loop: listen -> think -> speak -> listen.
 */
export class LiteVoice {
  private rec: SR | null = null;
  private active = false;
  private audio: HTMLAudioElement | null = null;
  private meterStream: MediaStream | null = null;
  private meterTimer: number | null = null;
  private speakTimer: number | null = null;

  async start() {
    if (!SRCtor) throw new Error('Speech recognition is not supported in this browser. Use Chrome/Edge or type your message.');
    const s = useStore.getState();
    s.set({ voice: 'connecting', error: null, mode: 'lite' });
    try {
      await this.startMeter();
    } catch {
      s.set({ voice: 'off', error: 'Microphone permission denied. Allow mic access and try again.' });
      return;
    }
    this.active = true;
    this.listen();
  }

  private async startMeter() {
    this.meterStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(this.meterStream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    this.meterTimer = window.setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      if (useStore.getState().voice === 'listening') useStore.getState().set({ micLevel: lvl });
    }, 90);
  }

  private listen() {
    if (!this.active || !SRCtor) return;
    const rec = new SRCtor();
    // Hindi choice -> hi-IN recognition (Devanagari); English/Hinglish/Auto -> en-IN (best for Roman Hinglish).
    rec.lang = useStore.getState().language === 'hi' ? 'hi-IN' : 'en-IN';
    rec.continuous = false;
    rec.interimResults = false;
    let got = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results).map((r: any) => r[0].transcript).join(' ').trim();
      if (text) { got = true; this.handleUtterance(text); }
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed') { useStore.getState().set({ error: 'Microphone permission denied.' }); this.stop(); }
    };
    rec.onend = () => { if (!got && this.active && useStore.getState().voice === 'listening') this.listen(); };
    this.rec = rec;
    useStore.getState().set({ voice: 'listening' });
    try { rec.start(); } catch { /* already started */ }
  }

  /** Send text (spoken or typed) through the agent and speak the reply. */
  async handleUtterance(text: string) {
    const s = useStore.getState();
    const history = [...s.messages.map((m) => ({ role: m.role, content: m.text })), { role: 'user' as const, content: text }];
    if (this.active) s.set({ voice: 'thinking', micLevel: 0 });
    try {
      const { reply } = await api.chat(history, useStore.getState().language);
      await this.speak(reply);
    } catch (e) {
      useStore.getState().set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (this.active) this.listen();
    }
  }

  async speak(text: string) {
    const s = useStore.getState();
    if (!s.caps?.murf) return; // no TTS configured: transcript only
    try {
      const blob = await api.tts(text);
      useStore.getState().set({ ttsNote: null });
      const url = URL.createObjectURL(blob);
      this.audio?.pause();
      const audio = new Audio(url);
      this.audio = audio;
      s.set({ voice: this.active ? 'speaking' : s.voice });
      this.speakTimer = window.setInterval(() => useStore.getState().set({ agentLevel: 0.35 + Math.random() * 0.5 }), 110);
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    } catch (e) {
      // Text fallback: keep the reply visible, tell the user voice is unavailable for this language/voice.
      const hindi = /[ऀ-ॿ]/.test(text);
      useStore.getState().set({ ttsNote: `Voice unavailable${hindi ? ' for Hindi (hi-IN)' : ''} — showing text reply. (${e instanceof Error ? e.message : e})` });
    } finally {
      if (this.speakTimer) clearInterval(this.speakTimer);
      useStore.getState().set({ agentLevel: 0 });
    }
  }

  stop() {
    this.active = false;
    this.rec?.abort();
    this.audio?.pause();
    if (this.meterTimer) clearInterval(this.meterTimer);
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.meterStream?.getTracks().forEach((t) => t.stop());
    this.meterStream = null;
    useStore.getState().set({ voice: 'off', micLevel: 0, agentLevel: 0 });
  }

  get isActive() { return this.active; }
}
