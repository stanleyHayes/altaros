/**
 * Whether this build can do WebRTC at all.
 *
 * `react-native-webrtc` is a NATIVE module. It cannot run in Expo Go, and it
 * cannot run in a JS-only test environment — it needs a development build or a
 * production build that includes it. That is a real constraint of the platform,
 * not something a polyfill fixes.
 *
 * So the app asks rather than assumes. A live screen that called into a missing
 * native module would crash the app the moment a member tapped a service; one
 * that checks can say "watching live needs the full app" and leave everything
 * else working. The failure a member sees should be a sentence, not a crash.
 */

export interface WebRTCModule {
  RTCPeerConnection: new (config: object) => RTCPeerConnectionLike;
  RTCSessionDescription: new (init: { type: string; sdp: string }) => object;
  mediaDevices: unknown;
}

/** The parts of RTCPeerConnection the live viewer uses. */
export interface RTCPeerConnectionLike {
  addTransceiver(kind: string, init: { direction: string }): void;
  createOffer(options?: object): Promise<{ type: string; sdp: string }>;
  createAnswer(options?: object): Promise<{ type: string; sdp: string }>;
  setLocalDescription(description: object): Promise<void>;
  setRemoteDescription(description: object): Promise<void>;
  close(): void;
  localDescription: { type: string; sdp: string } | null;
  ontrack: ((event: { streams: unknown[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  connectionState: string;
  iceGatheringState: string;
  onicegatheringstatechange: (() => void) | null;
}

let cached: WebRTCModule | null | undefined;

/**
 * Load react-native-webrtc, or return null when it is not in this build.
 *
 * The require is deliberately dynamic and wrapped. A static import would make
 * the module a hard dependency of every screen that imports this file, which
 * means the app fails to start in Expo Go rather than failing to stream.
 */
export function loadWebRTC(): WebRTCModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-webrtc') as Partial<WebRTCModule>;
    cached =
      mod && typeof mod.RTCPeerConnection === 'function'
        ? (mod as WebRTCModule)
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether live video can be shown in this build. */
export function canStream(): boolean {
  return loadWebRTC() !== null;
}

/** What to tell a member when it cannot. */
export const NO_STREAMING_MESSAGE =
  'Watching live needs the full app from the App Store or Play Store.';

/** Reset the cache. Tests only. */
export function resetWebRTCCache(): void {
  cached = undefined;
}
