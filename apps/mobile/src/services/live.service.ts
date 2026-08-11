import api from './api';
import { unwrapApiData } from './api-envelope';

/**
 * Live services, and the one-tap giving that happens inside them.
 *
 * The point of putting the service in the app rather than linking to Zoom is
 * that giving can happen without leaving it. A member who has to open a mobile
 * money app mid-sermon, find the church's number and type an amount has left
 * the service; most do not come back, and the offering is what it was before.
 */

export type SessionStatus = 'scheduled' | 'live' | 'ended';
export type SessionKind = 'broadcast' | 'room';

export interface LiveSession {
  id: string;
  title: string;
  description?: string;
  kind: SessionKind;
  status: SessionStatus;
  currentViewers: number;
  maxViewers: number;
  recording: boolean;
  startedAt?: string;
  endedAt?: string;
  campaignId?: string;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface LiveGrant {
  roomId: string;
  token: string;
  role: 'publisher' | 'viewer';
  /**
   * Handed out per join rather than baked into the app.
   *
   * Managed TURN credentials are short-lived by design; an app shipped with a
   * static one stops connecting the day they rotate, and it fails for every
   * member at once with nothing in the app to explain it.
   */
  iceServers: IceServer[];
  expiresAt: string;
}

/**
 * What a member is told before they connect.
 *
 * Delivered with the grant, in the same response, so the app can show it BEFORE
 * opening any connection. A recorded service is sensitive personal data under
 * Ghana's Act 843 — it reveals religious belief — and a notice that appears
 * after someone's camera is on is not a notice.
 */
export interface RecordingNotice {
  recording: boolean;
  notice?: string;
  keptUntil?: string;
}

export interface JoinResult {
  grant: LiveGrant;
  recording: RecordingNotice;
}

function isSession(value: unknown): value is LiveSession {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<LiveSession>;
  return (
    typeof s.id === 'string' &&
    s.id.length > 0 &&
    typeof s.title === 'string' &&
    (s.status === 'scheduled' || s.status === 'live' || s.status === 'ended')
  );
}

function isGrant(value: unknown): value is LiveGrant {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<LiveGrant>;
  return (
    typeof g.roomId === 'string' &&
    typeof g.token === 'string' &&
    g.token.length > 0 &&
    Array.isArray(g.iceServers)
  );
}

/**
 * How often the app tells the server it is still watching.
 *
 * The server reclaims a seat after 90 seconds of silence. Beating that with
 * room to spare matters because people do not leave, they lose signal — and a
 * seat held by someone who is gone is a seat a real member is turned away
 * from on a capped tier.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

const liveService = {
  /** This church's services, newest first. */
  async sessions(): Promise<LiveSession[]> {
    const { data } = await api.get<unknown>('/live/sessions');
    const payload = unwrapApiData(data, 'Could not load the services.') as {
      sessions?: unknown;
    };
    if (!Array.isArray(payload?.sessions)) return [];
    return payload.sessions.filter(isSession);
  },

  /**
   * Take a seat in a live service.
   *
   * Returns the recording notice alongside the grant so the caller can show it
   * before connecting anything.
   */
  async join(sessionId: string): Promise<JoinResult> {
    const { data } = await api.post<unknown>(`/live/sessions/${sessionId}/join`, {});
    const payload = unwrapApiData(data, 'Could not join the service.') as {
      grant?: unknown;
      recording?: RecordingNotice;
    };
    if (!isGrant(payload?.grant)) {
      throw new Error('Could not join the service.');
    }
    return {
      grant: payload.grant,
      // A missing notice is treated as NOT recording, which is the honest
      // default: announcing a recording that does not exist would teach
      // members to ignore the notice when it does.
      recording: payload.recording ?? { recording: false },
    };
  },

  /** Give up the seat. */
  async leave(sessionId: string): Promise<void> {
    await api.post(`/live/sessions/${sessionId}/leave`, {});
  },

  /** Tell the server the member is still watching. */
  async heartbeat(sessionId: string): Promise<void> {
    await api.post(`/live/sessions/${sessionId}/heartbeat`, {});
  },
};

export default liveService;
