import { get, post } from './api';

/**
 * Live services — the church's side.
 *
 * Scheduling, going live, ending, and the recordings that come out of it.
 * Broadcasting itself happens in the app on the phone that has the camera;
 * this is the control surface a church runs the service from.
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
  /**
   * The seat cap, SNAPSHOTTED from the tier when the service started.
   *
   * Snapshotted rather than read live so a subscription lapsing mid-sermon
   * cannot start turning a congregation away from a service already under way.
   */
  maxViewers: number;
  peakViewers: number;
  recording: boolean;
  campaignId?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}

export interface ScheduleSessionPayload {
  title: string;
  description?: string;
  kind?: SessionKind;
  campaignId?: string;
  /**
   * Whether to record.
   *
   * Off unless asked for. A recorded service captures the congregation, which
   * under Ghana's Act 843 s.1 is sensitive personal data — it reveals
   * religious belief — so a church that never thinks about it never records.
   */
  recording?: boolean;
}

export type RecordingStatus = 'recording' | 'ready' | 'failed' | 'deleted';

export interface Recording {
  id: string;
  sessionId: string;
  title: string;
  status: RecordingStatus;
  sizeBytes?: number;
  announcedAt: string;
  startedAt: string;
  endedAt?: string;
  /** When this is erased. Always set. */
  deleteAfter: string;
  deletedAt?: string;
}

export interface RetentionPolicy {
  defaultDays: number;
  maximumDays: number;
}

export interface RecordingsResult {
  recordings: Recording[];
  retention: RetentionPolicy;
}

export const liveService = {
  async sessions(): Promise<LiveSession[]> {
    const result = await get<{ sessions?: LiveSession[] }>('/live/sessions');
    return Array.isArray(result?.sessions) ? result.sessions : [];
  },

  async schedule(payload: ScheduleSessionPayload): Promise<LiveSession> {
    const result = await post<{ session: LiveSession }>('/live/sessions', payload);
    return result.session;
  },

  /** Take a scheduled service live. */
  async start(id: string): Promise<LiveSession> {
    const result = await post<{ session: LiveSession }>(`/live/sessions/${id}/start`, {});
    return result.session;
  },

  /** End the service and disconnect everyone. */
  async end(id: string): Promise<LiveSession> {
    const result = await post<{ session: LiveSession }>(`/live/sessions/${id}/end`, {});
    return result.session;
  },

  async recordings(): Promise<RecordingsResult> {
    const result = await get<RecordingsResult>('/live/recordings');
    return {
      recordings: Array.isArray(result?.recordings) ? result.recordings : [],
      retention: result?.retention ?? { defaultDays: 365, maximumDays: 1095 },
    };
  },
};

export default liveService;
