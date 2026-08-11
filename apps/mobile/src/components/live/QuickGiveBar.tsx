import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, spacing, typography } from '../../theme';
import quickGiveService, {
  TapError,
  type QuickGiveOptions,
} from '../../services/quick-give.service';

/**
 * Give during the service, without leaving it.
 *
 * The whole reason to host the stream rather than link to Zoom. A member who
 * has to open a mobile money app, find the church's number and type an amount
 * has left the service, and most do not come back — the moment of response
 * passes while they are in another app.
 */

interface Props {
  sessionId: string;
  campaignId?: string;
}

/** A tap id unique to this press, repeated if the press is retried. */
function newTapId(): string {
  return `tap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatPreset(minor: number): string {
  return `₵${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function QuickGiveBar({ sessionId, campaignId }: Props) {
  const [options, setOptions] = useState<QuickGiveOptions | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [given, setGiven] = useState<number | null>(null);

  // Held across renders so a retry of the SAME press reuses its id. A new id
  // per render would defeat the server's idempotency and charge twice for one
  // intention — the exact failure one-tap giving exists to avoid.
  const tapIdRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await quickGiveService.options();
        if (!cancelled) setOptions(loaded);
      } catch {
        // Silent. A member watching a service does not need an error about a
        // giving bar they have not touched; the failure surfaces on the tap,
        // where it is about something they just did.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const give = useCallback(
    async (amountMinor: number) => {
      if (pending !== null) return;
      setPending(amountMinor);
      setMessage(null);
      if (!tapIdRef.current) tapIdRef.current = newTapId();

      try {
        await quickGiveService.tap({
          amountMinor,
          currency: 'GHS',
          sessionId,
          campaignId,
          tapId: tapIdRef.current,
        });
        if (!mounted.current) return;
        setGiven(amountMinor);
        tapIdRef.current = null;
      } catch (error) {
        if (!mounted.current) return;
        if (error instanceof TapError) {
          setMessage(error.message);
          // A duplicate means the gift LANDED and the second press was
          // absorbed. Showing it as a success is the truthful outcome and
          // stops a third press.
          if (error.reason === 'duplicate') {
            setGiven(amountMinor);
            tapIdRef.current = null;
          }
          // Every other failure keeps the tap id, so a retry of this same
          // press is still recognised as one gift.
        } else {
          setMessage('We could not complete that gift. Nothing has been charged.');
        }
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [campaignId, pending, sessionId],
  );

  if (!options) return null;

  if (given !== null) {
    return (
      <View style={[styles.bar, styles.thanks]}>
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
        <Text style={styles.thanksText}>
          Thank you — {formatPreset(given)} received.
        </Text>
        <TouchableOpacity onPress={() => setGiven(null)} accessibilityRole="button">
          <Text style={styles.again}>Give again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No saved instrument: the bar says how to get one rather than hiding.
  // Hiding would leave the feature undiscoverable to exactly the members who
  // have never used it.
  if (!options.paymentMethod) {
    return (
      <View style={styles.bar}>
        <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
        <Text style={styles.setupText}>
          Give once the usual way and save your details to give in one tap here.
        </Text>
      </View>
    );
  }

  const presets = options.presetAmounts.filter((a) => a <= options.tapLimit).slice(0, 4);

  return (
    <View style={styles.wrapper}>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.bar}>
        <Text style={styles.label}>Give</Text>
        {presets.map((amount) => (
          <TouchableOpacity
            key={amount}
            style={[styles.preset, pending === amount && styles.presetBusy]}
            onPress={() => void give(amount)}
            disabled={pending !== null}
            accessibilityRole="button"
            accessibilityLabel={`Give ${formatPreset(amount)} now`}
          >
            {pending === amount ? (
              <ActivityIndicator color={colors.surface} size="small" />
            ) : (
              <Text style={styles.presetText}>{formatPreset(amount)}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.instrument}>
        {options.paymentMethod.brand ?? options.paymentMethod.channel ?? 'Saved'}
        {options.paymentMethod.last4 ? ` ••${options.paymentMethod.last4}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.sm,
    marginRight: spacing.xs,
  },
  preset: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  presetBusy: { opacity: 0.7 },
  presetText: {
    color: colors.surface,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.md,
  },
  instrument: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.xs,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  setupText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.sm,
  },
  thanks: { justifyContent: 'center' },
  thanksText: {
    color: colors.text,
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.sm,
    flex: 1,
  },
  again: {
    color: colors.primary,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.sm,
  },
  message: {
    color: colors.error,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.xs,
    marginBottom: spacing.xs,
  },
});

export default QuickGiveBar;
