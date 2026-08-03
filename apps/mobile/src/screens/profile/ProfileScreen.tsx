import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import { createSubmissionLock } from '../../services/submission-lock';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { sessionPlatform, sessionStorageLabel } from '../../services/session-copy';
import { connectivityErrorMessage } from '../../services/connectivity';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';

type ProfileNav = NativeStackNavigationProp<RootStackParamList>;

interface ProfileIdentity {
  churchId?: string;
  memberId?: string;
}

export function ownsProfileIdentity(
  active: ProfileIdentity,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return active.churchId === startedChurchId && active.memberId === startedMemberId;
}

export function ownsMountedProfileAction(
  mounted: boolean,
  active: ProfileIdentity,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return mounted && ownsProfileIdentity(active, startedChurchId, startedMemberId);
}

export function profileExternalActionState(
  url: string,
  offline: boolean,
  openingUrl: string | null,
): { disabled: boolean; busy: boolean; hint?: string } {
  const busy = openingUrl === url;
  const disabled = offline || openingUrl !== null;
  const hint = offline ? 'Reconnect to open this page.'
    : busy ? 'Opening this page on your device.'
      : openingUrl !== null ? 'Wait for the current page to open.' : undefined;
  return { disabled, busy, ...(hint ? { hint } : {}) };
}

export function profileSessionActionState(
  offline: boolean,
  globalSigningOut: boolean,
): {
  local: { disabled: boolean; hint: string };
  global: { disabled: boolean; busy: boolean; hint: string };
} {
  return {
    local: {
      disabled: globalSigningOut,
      hint: globalSigningOut
        ? 'Wait while every session is being ended.'
        : 'Signs out this device immediately, including while offline.',
    },
    global: {
      disabled: offline || globalSigningOut,
      busy: globalSigningOut,
      hint: offline
        ? 'Reconnect to end your sessions on every device.'
        : globalSigningOut
          ? 'Every session is being ended.'
          : 'Ends every session after the server confirms revocation.',
    },
  };
}

export function installedVersionLabel(
  nativeVersion: string | null,
  nativeBuildVersion: string | null,
  configuredVersion = '1.0.0',
): string {
  const safe = (value: string | null, fallback = '') => {
    const normalized = value?.trim() ?? '';
    return normalized && normalized.length <= 64 && !/[\u0000-\u001F\u007F]/.test(normalized)
      ? normalized
      : fallback;
  };
  const version = safe(nativeVersion, safe(configuredVersion, 'Unknown version'));
  const build = safe(nativeBuildVersion);
  return `ALTAR OS · ${version}${build ? ` (${build})` : ''}`;
}

export function ProfileScreen() {
  const navigation = useNavigation<ProfileNav>();
  const { user, logout, logoutEverywhere, refreshUser } = useAuth();
  const offline = useKnownOffline();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [actionError, setActionError] = useState('');
  const [globalSigningOut, setGlobalSigningOut] = useState(false);
  const [openingUrl, setOpeningUrl] = useState<string | null>(null);
  const sessionActionLock = useRef(createSubmissionLock());
  const externalActionLock = useRef(createSubmissionLock());
  const refreshLock = useRef(createSubmissionLock());
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<ProfileIdentity>({ churchId: user?.churchId, memberId: user?.memberId });
  const previousIdentityRef = useRef<ProfileIdentity>({ churchId: user?.churchId, memberId: user?.memberId });
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.memberId };
  const fullName = `${user?.firstName || 'Member'} ${user?.lastName || ''}`.trim();
  const versionLabel = installedVersionLabel(
    Application.nativeApplicationVersion,
    Application.nativeBuildVersion,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const previous = previousIdentityRef.current;
    const current = activeIdentityRef.current;
    if (previous.churchId === current.churchId && previous.memberId === current.memberId) return;
    previousIdentityRef.current = current;
    sessionActionLock.current = createSubmissionLock();
    externalActionLock.current = createSubmissionLock();
    refreshLock.current = createSubmissionLock();
    setRefreshing(false);
    setRefreshError('');
    setActionError('');
    setGlobalSigningOut(false);
    setOpeningUrl(null);
  }, [user?.churchId, user?.memberId]);

  const ownsActiveIdentity = (churchId: string, memberId: string) => ownsMountedProfileAction(
    mountedRef.current, activeIdentityRef.current, churchId, memberId,
  );

  const handleLogout = () => {
    const actionLock = sessionActionLock.current;
    if (!actionLock.acquire()) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)) {
      actionLock.release();
      return;
    }
    let started = false;
    Alert.alert('Sign out?', 'You will need a new code or your password to return.', [
      { text: 'Cancel', style: 'cancel', onPress: () => actionLock.release() },
      { text: 'Sign out', style: 'destructive', onPress: () => {
        if (!ownsActiveIdentity(startedChurchId, startedMemberId)) {
          actionLock.release();
          return;
        }
        started = true;
        void logout().finally(() => actionLock.release()).catch(() => undefined);
      } },
    ], { cancelable: true, onDismiss: () => { if (!started) actionLock.release(); } });
  };

  const handleLogoutEverywhere = () => {
    const actionLock = sessionActionLock.current;
    if (!actionLock.acquire()) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)) {
      actionLock.release();
      return;
    }
    let started = false;
    Alert.alert(
      'Sign out on every device?',
      'This ends every Altar OS session for your account, including this device.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => actionLock.release() },
        { text: 'Sign out everywhere', style: 'destructive', onPress: () => {
          if (!ownsActiveIdentity(startedChurchId, startedMemberId)) {
            actionLock.release();
            return;
          }
          started = true;
          setGlobalSigningOut(true);
          setActionError('');
          void logoutEverywhere()
            .catch(() => {
              if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
                setActionError('Other sessions could not be ended. You are still signed in here; reconnect and try again.');
              }
            })
            .finally(() => {
              if (ownsActiveIdentity(startedChurchId, startedMemberId)) setGlobalSigningOut(false);
              actionLock.release();
            });
        } },
      ],
      { cancelable: true, onDismiss: () => { if (!started) actionLock.release(); } },
    );
  };

  const handleRefresh = async () => {
    const actionLock = refreshLock.current;
    if (!actionLock.acquire()) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)) {
      actionLock.release();
      return;
    }
    setRefreshing(true);
    setRefreshError('');
    try {
      await refreshUser();
    } catch (cause) {
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
        setRefreshError(connectivityErrorMessage(cause, 'Your latest profile details could not be loaded.'));
      }
    } finally {
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) setRefreshing(false);
      actionLock.release();
    }
  };

  const openExternal = async (url: string, label: string) => {
    const actionLock = externalActionLock.current;
    if (offline || !actionLock.acquire()) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)) {
      actionLock.release();
      return;
    }
    setOpeningUrl(url);
    setActionError('');
    try {
      if (!(await Linking.canOpenURL(url))) throw new Error('unsupported URL');
      if (!ownsActiveIdentity(startedChurchId, startedMemberId)) return;
      await Linking.openURL(url);
    } catch {
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
        setActionError(`${label} could not be opened on this device.`);
      }
    } finally {
      actionLock.release();
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) setOpeningUrl(null);
    }
  };

  const menu = [
    { label: 'Notifications', detail: 'Messages and push alerts', icon: 'notifications-outline' as const, external: false, action: () => navigation.navigate('Notifications') },
    { label: 'Giving history', detail: 'Receipts and pending gifts', icon: 'receipt-outline' as const, external: false, action: () => navigation.navigate('GivingHistory') },
    { label: 'Welfare & care', detail: 'Private pastoral support', icon: 'hand-left-outline' as const, external: false, action: () => navigation.navigate('Welfare') },
    { label: 'Privacy', detail: 'How Altar OS handles your data', icon: 'finger-print-outline' as const, external: true, url: 'https://altaros.com/privacy', action: () => { void openExternal('https://altaros.com/privacy', 'Privacy information'); } },
    { label: 'Help centre', detail: 'Get support from our team', icon: 'chatbubble-ellipses-outline' as const, external: true, url: 'https://altaros.com/help', action: () => { void openExternal('https://altaros.com/help', 'Help centre'); } },
  ];
  const sessionActions = profileSessionActionState(offline, globalSigningOut);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { if (!offline) void handleRefresh(); }} enabled={!offline} tintColor={colors.primary} />}
    >
      {refreshError ? <Text style={styles.refreshError} accessibilityRole="alert">{refreshError}</Text> : null}
      {actionError ? <Text style={styles.refreshError} accessibilityRole="alert">{actionError}</Text> : null}
      <View style={styles.header}>
        <View style={styles.headerOrb} accessible={false} />
        <View style={styles.headerRing} accessible={false} />
        <Text style={styles.profileEyebrow}>MEMBER PROFILE</Text>
        <Avatar name={fullName} uri={user?.avatar} size="xl" />
        <Text style={styles.name}>{fullName}</Text>
        <Text style={styles.contact}>{user?.phone || user?.email || 'Member account'}</Text>
        <View style={styles.churchBadge}><Text style={styles.churchText}>{user?.churchName || 'Altar OS member'}</Text></View>
      </View>

      <View style={styles.identityRow}>
        <View><Text style={styles.identityLabel}>ROLE</Text><Text style={styles.identityValue}>{user?.role?.replaceAll('_', ' ') || 'Member'}</Text></View>
        <View style={styles.identityDivider} />
        <View><Text style={styles.identityLabel}>SESSION</Text><Text style={styles.identityValue}>{sessionStorageLabel(sessionPlatform(Platform.OS))}</Text></View>
      </View>

      <Text style={styles.sectionTitle}>Account</Text>
      <Card padded={false}>
        {menu.map((item, index) => {
          const externalState = item.url
            ? profileExternalActionState(item.url, offline, openingUrl)
            : { disabled: false, busy: false };
          return (
          <TouchableOpacity key={item.label} onPress={item.action} disabled={externalState.disabled} style={[styles.menuRow, index > 0 && styles.menuBorder, externalState.disabled && styles.actionDisabled]} accessibilityRole={item.external ? 'link' : 'button'} accessibilityState={{ disabled: externalState.disabled, busy: externalState.busy }} accessibilityHint={externalState.hint}>
            <View style={styles.menuIcon}><Ionicons name={item.icon} size={20} color={colors.primaryDark} accessible={false} /></View>
            <View style={styles.menuText}><Text style={styles.menuLabel}>{item.label}</Text><Text style={styles.menuDetail}>{externalState.busy ? 'Opening on your device…' : item.detail}</Text></View>
            <Ionicons name={item.external ? 'open-outline' : 'chevron-forward'} size={18} color={colors.muted} accessible={false} />
          </TouchableOpacity>
          );
        })}
      </Card>

      <View style={styles.logout}>
        <Button
          title="Sign out"
          variant="outline"
          onPress={handleLogout}
          disabled={sessionActions.local.disabled}
          accessibilityHint={sessionActions.local.hint}
          fullWidth
        />
        <TouchableOpacity
          onPress={handleLogoutEverywhere}
          accessibilityRole="button"
          accessibilityHint={sessionActions.global.hint}
          accessibilityState={{ disabled: sessionActions.global.disabled, busy: sessionActions.global.busy }}
          disabled={sessionActions.global.disabled}
          style={[styles.logoutEverywhere, sessionActions.global.disabled && styles.actionDisabled]}
        >
          <Text style={styles.logoutEverywhereText}>{globalSigningOut ? 'Ending all sessions…' : 'Sign out on all devices'}</Text>
        </TouchableOpacity>
        <Text style={styles.profileNote}>To change your name or contact details, ask your church office to update your member record.</Text>
        <Text style={styles.version}>{versionLabel}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, paddingBottom: spacing['4xl'] },
  header: { alignItems: 'center', backgroundColor: colors.text, borderRadius: borderRadius['2xl'], padding: spacing['2xl'], overflow: 'hidden' },
  headerOrb: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: '#174C45', top: -130, right: -58 },
  headerRing: { position: 'absolute', width: 130, height: 130, borderRadius: 65, borderWidth: 1, borderColor: 'rgba(109,213,196,.28)', top: -64, right: 18 },
  profileEyebrow: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.4, marginBottom: spacing.lg },
  name: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes['2xl'], marginTop: spacing.md },
  contact: { color: 'rgba(255,255,255,.58)', fontFamily: typography.families.regular, fontSize: typography.sizes.md, marginTop: spacing.xs },
  churchBadge: { backgroundColor: 'rgba(109,213,196,.14)', borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.md },
  churchText: { color: colors.primaryLight, fontFamily: typography.families.medium, fontSize: typography.sizes.sm },
  identityRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.xl },
  identityDivider: { width: 1, backgroundColor: colors.border },
  identityLabel: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.2 },
  identityValue: { color: colors.textSecondary, fontSize: typography.sizes.sm, textTransform: 'capitalize', marginTop: 3 },
  sectionTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.xl, marginBottom: spacing.md },
  menuRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.base },
  menuBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  menuIcon: { width: 42, height: 42, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryLight, marginRight: spacing.md },
  menuText: { flex: 1 },
  menuLabel: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.base },
  menuDetail: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 3 },
  logout: { marginTop: spacing['2xl'], alignItems: 'center' },
  logoutEverywhere: { padding: spacing.base },
  actionDisabled: { opacity: 0.5 },
  logoutEverywhereText: { color: colors.error, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  profileNote: { color: colors.muted, fontSize: typography.sizes.sm, lineHeight: 19, textAlign: 'center', maxWidth: 420, marginTop: spacing.sm },
  refreshError: { color: colors.error, backgroundColor: '#FFF7F5', borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md, fontSize: typography.sizes.sm },
  version: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.base },
});
