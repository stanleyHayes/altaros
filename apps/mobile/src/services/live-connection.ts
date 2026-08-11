import { resolveApiBaseUrl } from './api-config';
import { loadWebRTC, type RTCPeerConnectionLike } from './webrtc-availability';
import type { LiveGrant } from './live.service';

/**
 * The media connection to a live service.
 *
 * Two channels, and they do different jobs. The WebSocket carries signalling —
 * offers and answers — and stays open for the whole service because the SERVER
 * starts exchanges: someone who opens the app before the service begins is
 * already connected when the camera comes on, and nothing they do would prompt
 * the offer that gets them the video. The peer connection carries the media.
 */

type Status = 'connecting' | 'watching' | 'reconnecting' | 'failed' | 'closed';

export interface LiveConnectionHandlers {
  onStream: (stream: unknown) => void;
  onStatus: (status: Status, detail?: string) => void;
}

interface SignalMessage {
  type: string;
  sdp?: { type: string; sdp: string };
  reason?: string;
}

/** How long to wait for ICE candidates before sending the offer anyway. */
const GATHER_TIMEOUT_MS = 5_000;

/** How long the socket may sit idle before a ping. */
const PING_INTERVAL_MS = 25_000;

/**
 * Build the signalling URL.
 *
 * The grant travels in the query string because a browser cannot set an
 * Authorization header when opening a WebSocket. That is exactly why the grant
 * is a narrow, short-lived room credential and never the account's token — a
 * session token in a URL is an account takeover from a proxy log.
 */
export function signalUrl(base: string, token: string): string {
  const url = new URL('/api/v1/live/signal', base);
  url.searchParams.set('grant', token);
  // Rewritten on the STRING rather than by assigning url.protocol, which is
  // read-only in React Native's URL and silently does nothing there — the
  // socket would then be opened over http and simply fail to upgrade.
  return url
    .toString()
    .replace(/^https:/, 'wss:')
    .replace(/^http:/, 'ws:');
}

/** The API this build talks to, resolved the same way the HTTP client does. */
function apiBaseUrl(): string {
  return resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);
}

export class LiveConnection {
  private socket: WebSocket | null = null;
  private pc: RTCPeerConnectionLike | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly grant: LiveGrant,
    private readonly handlers: LiveConnectionHandlers,
  ) {}

  /** Open the connection and start watching. */
  async start(): Promise<void> {
    const webrtc = loadWebRTC();
    if (!webrtc) {
      this.handlers.onStatus('failed', 'streaming-unavailable');
      return;
    }
    this.handlers.onStatus('connecting');

    const pc = new webrtc.RTCPeerConnection({
      iceServers: this.grant.iceServers,
    }) as RTCPeerConnectionLike;
    this.pc = pc;

    pc.ontrack = (event) => {
      if (event.streams && event.streams.length > 0) {
        this.handlers.onStream(event.streams[0]);
        this.handlers.onStatus('watching');
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      switch (pc.connectionState) {
        case 'connected':
          this.handlers.onStatus('watching');
          break;
        case 'disconnected':
          // Not fatal. Phones move between wifi and mobile data mid-service,
          // and ICE often recovers on its own — tearing down here would turn
          // a two-second blip into a rejoin.
          this.handlers.onStatus('reconnecting');
          break;
        case 'failed':
          this.handlers.onStatus('failed', 'connection-failed');
          break;
        default:
          break;
      }
    };

    // Receive only. A viewer that offered to send would be asking the server
    // for an upload path it will never use, and on a broadcast it would look
    // to the SFU like a second publisher.
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    this.socket = new WebSocket(signalUrl(apiBaseUrl(), this.grant.token));
    this.socket.onopen = () => {
      void this.sendOffer(webrtc);
    };
    this.socket.onmessage = (event) => {
      void this.onMessage(webrtc, event.data as string);
    };
    this.socket.onerror = () => {
      if (!this.closed) this.handlers.onStatus('failed', 'signalling-failed');
    };
    this.socket.onclose = () => {
      if (!this.closed) this.handlers.onStatus('failed', 'signalling-closed');
    };

    this.ping = setInterval(() => {
      // Mobile carrier NAT drops idle mappings in as little as thirty seconds,
      // and a signalling channel is idle for most of a sermon. Without this
      // the path is silently gone when the server next sends an offer.
      this.send({ type: 'ping' });
    }, PING_INTERVAL_MS);
  }

  private async sendOffer(webrtc: NonNullable<ReturnType<typeof loadWebRTC>>): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    try {
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      await this.waitForCandidates(pc);
      this.send({ type: 'offer', sdp: pc.localDescription ?? offer });
    } catch {
      this.handlers.onStatus('failed', 'offer-failed');
    }
    void webrtc;
  }

  /**
   * Wait for ICE gathering, but not forever.
   *
   * Gathering can stall on a network that swallows STUN responses. Sending a
   * partial offer still connects over whatever candidates were found; waiting
   * indefinitely means a member stares at a spinner with nothing to explain it.
   */
  private waitForCandidates(pc: RTCPeerConnectionLike): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.onicegatheringstatechange = null;
        resolve();
      };
      const timer = setTimeout(done, GATHER_TIMEOUT_MS);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
    });
  }

  private async onMessage(
    webrtc: NonNullable<ReturnType<typeof loadWebRTC>>,
    raw: string,
  ): Promise<void> {
    let msg: SignalMessage;
    try {
      msg = JSON.parse(raw) as SignalMessage;
    } catch {
      return;
    }
    const pc = this.pc;
    if (!pc) return;

    switch (msg.type) {
      case 'answer':
        if (msg.sdp) {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription(msg.sdp));
        }
        break;

      case 'offer':
        // The SERVER offering us something new — the publisher's camera came
        // on after we connected. Answering is what turns a silent connection
        // into the service.
        if (msg.sdp) {
          await pc.setRemoteDescription(new webrtc.RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer({});
          await pc.setLocalDescription(answer);
          this.send({ type: 'answer', sdp: pc.localDescription ?? answer });
        }
        break;

      case 'error':
        this.handlers.onStatus('failed', msg.reason ?? 'server-error');
        break;

      default:
        break;
    }
  }

  private send(message: SignalMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /** Close everything. Safe to call more than once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }
    this.handlers.onStatus('closed');
  }
}

export default LiveConnection;
