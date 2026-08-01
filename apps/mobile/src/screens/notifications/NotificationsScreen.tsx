import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Card } from '../../components/common/Card';
import notificationService, { type MemberNotification } from '../../services/notification.service';
import { colors, spacing, typography } from '../../theme';

export function NotificationsScreen() {
  const [items, setItems] = useState<MemberNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState<Notifications.PermissionStatus | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      setItems(await notificationService.list());
    } catch {
      setError('Notifications are unavailable right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void Notifications.getPermissionsAsync().then((result) => setPermission(result.status));
  }, [load]);

  const enablePush = async () => {
    const result = await Notifications.requestPermissionsAsync();
    setPermission(result.status);
    if (result.status !== 'granted') return;
    try {
      const token = await Notifications.getExpoPushTokenAsync();
      await notificationService.registerDevice(token.data);
    } catch {
      setError('Push permission was granted, but this device could not be registered.');
    }
  };

  const markRead = async (item: MemberNotification) => {
    if (item.readAt) return;
    setItems((current) => current.map((value) => value.id === item.id ? { ...value, readAt: new Date().toISOString() } : value));
    try { await notificationService.markRead(item.id); } catch { /* Keep local state; next refresh reconciles. */ }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      contentContainerStyle={styles.content}
      ListHeaderComponent={permission !== 'granted' ? (
        <Card style={styles.permissionCard}>
          <Text style={styles.permissionTitle}>Stay in step with your church</Text>
          <Text style={styles.permissionBody}>Enable push alerts for event reminders, pastoral messages, and giving receipts.</Text>
          <TouchableOpacity onPress={() => void enablePush()} accessibilityRole="button"><Text style={styles.enable}>Enable notifications</Text></TouchableOpacity>
        </Card>
      ) : null}
      renderItem={({ item }) => (
        <TouchableOpacity onPress={() => void markRead(item)} activeOpacity={.8}>
          <Card style={[styles.item, !item.readAt && styles.unread]}>
            <View style={styles.itemHeader}><Text style={styles.title}>{item.title}</Text>{!item.readAt ? <View style={styles.dot} /> : null}</View>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.date}>{new Date(item.createdAt).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
          </Card>
        </TouchableOpacity>
      )}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>{error ? 'Nothing to show' : 'You are all caught up'}</Text><Text style={styles.emptyBody}>{error || 'New messages and reminders from your church will appear here.'}</Text></View>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, flexGrow: 1 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  permissionCard: { backgroundColor: colors.secondaryLight, borderColor: '#CBE8E0', marginBottom: spacing.xl },
  permissionTitle: { color: colors.text, fontSize: typography.sizes.lg, fontWeight: typography.weights.bold },
  permissionBody: { color: colors.textSecondary, fontSize: typography.sizes.md, lineHeight: 20, marginTop: spacing.sm },
  enable: { color: colors.primaryDark, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold, marginTop: spacing.md },
  item: { marginBottom: spacing.md },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.semibold, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginLeft: spacing.sm },
  body: { color: colors.textSecondary, fontSize: typography.sizes.md, lineHeight: 20, marginTop: spacing.sm },
  date: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.md },
  empty: { alignItems: 'center', padding: spacing['3xl'] },
  emptyTitle: { color: colors.text, fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold },
  emptyBody: { color: colors.muted, fontSize: typography.sizes.md, lineHeight: 21, textAlign: 'center', marginTop: spacing.sm },
});
