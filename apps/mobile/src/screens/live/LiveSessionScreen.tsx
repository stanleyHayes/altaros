import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, spacing, typography } from '../../theme';
import liveService, {
  HEARTBEAT_INTERVAL_MS,
  type LiveGrant,
  type RecordingNotice,
} from '../../services/live.service';
import LiveConnection from '../../services/live-connection';
import { canStream, loadWebRTC, NO_STREAMING_MESSAGE } from '../../services/webrtc-availability';
import QuickGiveBar from '../../components/live/QuickGiveBar';

/**
 * Watching a service.
 *
 * The order here is the point. A member is TOLD the service is recorded and
 * accepts before anything connects — not after their microphone is already
 * live. Ghana's Act 843 treats a recorded service as sensitive personal data,
 * because it reveals religious belief, and a notice that appears once someone
 * is already in the recording has informed nobody.
 */

type Params = { sessionId: string; title: string; campaignId?: string };
type Status = 'idle' | 'connecting' | 'watching' | 'reconnecting' | 'failed' | 'closed';

export function LiveSessionScreen() {
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const { sessionId, title, campaignId } = route.params;

  const [notice, setNotice] = useState<RecordingNotice | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [stream, setStream] = useState<unknown>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // The grant from the single join. Kept rather than re-fetched: joining
  // twice would be two round trips on a phone that is about to start pulling
  // video, for a credential we already hold.
  const grantRef = useRef<LiveGrant | null>(null);
  const connection = useRef<LiveConnection | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const joined = useRef(false);

  // Take a seat and read the notice. The seat is taken here rather than after
  // the notice is accepted, because the cap has to be enforced before a member
  // is shown a service they cannot get into — and the seat is given straight
  // back if they decline.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await liveService.join(sessionId);
        if (cancelled) return;
        joined.current = true;
        grantRef.current = result.grant;
        setNotice(result.recording);
        // Nothing to consent to: connect immediately rather than making a
        // member tap through a dialog that says nothing.
        if (!result.recording.recording) setAccepted(true);
      } catch {
        if (!cancelled) {
          setJoinError('We could not join this service. It may have ended or be full.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Hold the seat while watching. People do not leave, they lose signal, and
  // a seat held by someone who is gone is a seat a real member is turned away
  // from on a capped tier.
  useEffect(() => {
    if (!accepted || !joined.current) return undefined;
    heartbeat.current = setInterval(() => {
      void liveService.heartbeat(sessionId).catch(() => {
        // Swallowed on purpose: one missed heartbeat is not worth an error in
        // front of someone watching a sermon, and the next one is 30s away.
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeat.current) clearInterval(heartbeat.current);
      heartbeat.current = null;
    };
  }, [accepted, sessionId]);

  // Connect once accepted.
  useEffect(() => {
    if (!accepted || !joined.current || connection.current) return undefined;
    const grant = grantRef.current;
    if (!grant) return undefined;

    let live: LiveConnection | null = null;
    void (async () => {
      try {
        live = new LiveConnection(grant, {
          onStream: setStream,
          onStatus: (next, why) => {
            setStatus(next);
            setDetail(why ?? null);
          },
        });
        connection.current = live;
        await live.start();
      } catch {
        setStatus('failed');
        setDetail('join-failed');
      }
    })();
    return () => {
      live?.close();
      connection.current = null;
    };
  }, [accepted, sessionId]);

  const leave = useCallback(() => {
    connection.current?.close();
    connection.current = null;
    if (joined.current) {
      void liveService.leave(sessionId).catch(() => {
        // The server reclaims the seat after 90 seconds of silence anyway.
      });
      joined.current = false;
    }
    navigation.goBack();
  }, [navigation, sessionId]);

  // Always give the seat back on unmount, however the screen was left.
  useEffect(
    () => () => {
      connection.current?.close();
      if (joined.current) void liveService.leave(sessionId).catch(() => undefined);
    },
    [sessionId],
  );

  if (joinError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{joinError}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.secondary}>
          <Text style={styles.secondaryText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // The consent gate. Nothing has connected at this point.
  if (notice?.recording && !accepted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="recording-outline" size={40} color={colors.error} />
        <Text style={styles.consentTitle}>This service is recorded</Text>
        <Text style={styles.consentBody}>{notice.notice}</Text>
        {notice.keptUntil ? (
          <Text style={styles.consentKept}>
            The recording is kept until {new Date(notice.keptUntil).toLocaleDateString()}.
          </Text>
        ) : null}
        <TouchableOpacity
          style={styles.primary}
          onPress={() => setAccepted(true)}
          accessibilityRole="button"
          accessibilityLabel="Join the recorded service"
        >
          <Text style={styles.primaryText}>Join the service</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={leave} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>Not now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!canStream()) {
    return (
      <View style={styles.centered}>
        <Ionicons name="videocam-off-outline" size={40} color={colors.textSecondary} />
        <Text style={styles.consentTitle}>Live video is not available here</Text>
        <Text style={styles.consentBody}>{NO_STREAMING_MESSAGE}</Text>
        <TouchableOpacity onPress={leave} style={styles.secondary}>
          <Text style={styles.secondaryText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.video}>
        <VideoSurface stream={stream} status={status} detail={detail} />
      </View>

      <View style={styles.bar}>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity onPress={leave} accessibilityRole="button" accessibilityLabel="Leave">
          <Ionicons name="close" size={24} color={colors.surface} />
        </TouchableOpacity>
      </View>

      {/* Giving stays on screen for the whole service. Hiding it behind a menu
          is how a moment of response becomes a gift nobody made. */}
      <QuickGiveBar sessionId={sessionId} campaignId={campaignId} />
    </View>
  );
}

/**
 * The video itself.
 *
 * RTCView comes from the native module, so it is resolved at render rather than
 * imported: a static import would make this file fail to load in a build that
 * has no WebRTC, taking the whole screen with it.
 */
function VideoSurface({
  stream,
  status,
  detail,
}: {
  stream: unknown;
  status: Status;
  detail: string | null;
}) {
  const webrtc = loadWebRTC() as { RTCView?: React.ComponentType<Record<string, unknown>> } | null;
  const RTCView = webrtc?.RTCView;

  if (stream && RTCView) {
    return (
      <RTCView
        streamURL={(stream as { toURL: () => string }).toURL()}
        style={styles.rtcView}
        objectFit="contain"
      />
    );
  }

  if (status === 'failed') {
    return (
      <View style={styles.videoState}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.surface} />
        <Text style={styles.videoStateText}>
          {detail === 'streaming-unavailable'
            ? NO_STREAMING_MESSAGE
            : 'We lost the connection to this service.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.videoState}>
      <ActivityIndicator color={colors.surface} />
      <Text style={styles.videoStateText}>
        {status === 'reconnecting' ? 'Reconnecting…' : 'Connecting to the service…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.text },
  video: { flex: 1, backgroundColor: '#000' },
  rtcView: { flex: 1 },
  videoState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  videoStateText: {
    color: colors.surface,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  sessionTitle: {
    flex: 1,
    color: colors.surface,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  consentTitle: {
    color: colors.text,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.lg,
    textAlign: 'center',
  },
  consentBody: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  consentKept: {
    color: colors.textSecondary,
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryText: {
    color: colors.surface,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.md,
  },
  secondary: { padding: spacing.sm, minHeight: 44, justifyContent: 'center' },
  secondaryText: {
    color: colors.primary,
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.md,
  },
  errorText: {
    color: colors.error,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.md,
    textAlign: 'center',
  },
});

export default LiveSessionScreen;
