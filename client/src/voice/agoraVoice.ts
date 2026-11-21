import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack, type IRemoteAudioTrack } from 'agora-rtc-sdk-ng';
import { api } from '../lib/api';
import { useStore } from '../store';
import { BRAND } from '../brand';

AgoraRTC.setLogLevel(3); // warnings+errors only

/**
 * Full voice mode: browser <-> Agora RTC channel <-> Agora Conversational AI agent
 * (ASR -> our custom-LLM endpoint with tools -> Murf Falcon TTS).
 */
export class AgoraVoice {
  private client: IAgoraRTCClient | null = null;
  private mic: IMicrophoneAudioTrack | null = null;
  private agentTrack: IRemoteAudioTrack | null = null;
  private meter: number | null = null;
  private stopping = false;

  async start() {
    const st = useStore.getState();
    st.set({ voice: 'connecting', error: null });
    this.stopping = false;
    try {
      // Mic permission first so a denial fails fast with a clear message.
      this.mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true, encoderConfig: 'speech_standard' });
      const creds = await api.startAgent(useStore.getState().language);
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      this.client = client;

      client.on('user-published', async (user, mediaType) => {
        if (mediaType !== 'audio') return;
        await client.subscribe(user, 'audio');
        if (Number(user.uid) === creds.agentUid || !this.agentTrack) {
          this.agentTrack = user.audioTrack ?? null;
          this.agentTrack?.play();
        }
      });
      client.on('user-unpublished', (user) => {
        if (Number(user.uid) === creds.agentUid) this.agentTrack = null;
      });
      client.on('user-left', (user) => {
        if (Number(user.uid) === creds.agentUid && !this.stopping) {
          useStore.getState().set({ error: `${BRAND.name} left the call (idle timeout). Tap the orb to reconnect.` });
          this.stop();
        }
      });
      client.on('connection-state-change', (cur, _prev, reason) => {
        const s = useStore.getState();
        if (cur === 'RECONNECTING') s.set({ voice: 'reconnecting' });
        else if (cur === 'CONNECTED' && s.voice === 'reconnecting') s.set({ voice: 'listening' });
        else if (cur === 'DISCONNECTED' && !this.stopping) {
          s.set({ error: `Voice connection lost (${reason ?? 'unknown'}). Tap the orb to reconnect.` });
          this.stop();
        }
      });

      await client.join(creds.appId, creds.channel, creds.token || null, creds.uid);
      await client.publish([this.mic]);
      useStore.getState().set({ voice: 'listening' });

      this.meter = window.setInterval(() => {
        useStore.getState().set({
          micLevel: this.mic?.getVolumeLevel() ?? 0,
          agentLevel: this.agentTrack?.getVolumeLevel() ?? 0,
        });
      }, 90);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = /PERMISSION_DENIED|NotAllowedError/i.test(msg) ? 'Microphone permission denied. Allow mic access and try again.' : msg;
      useStore.getState().set({ error: friendly });
      await this.stop();
      throw e;
    }
  }

  async stop() {
    this.stopping = true;
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    this.mic?.close();
    this.mic = null;
    this.agentTrack = null;
    const c = this.client;
    this.client = null;
    useStore.getState().set({ voice: 'off', micLevel: 0, agentLevel: 0, thinking: false });
    await Promise.allSettled([c?.leave(), api.stopAgent()]);
  }

  setMuted(muted: boolean) { this.mic?.setEnabled(!muted); }
}
