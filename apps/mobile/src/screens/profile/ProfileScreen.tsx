import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';

type ProfileNav = NativeStackNavigationProp<RootStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<ProfileNav>();
  const { user, logout } = useAuth();
  const fullName = `${user?.firstName || 'Member'} ${user?.lastName || ''}`.trim();

  const handleLogout = () => Alert.alert('Sign out?', 'You will need a new code or your password to return.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
  ]);

  const menu = [
    { label: 'Notifications', detail: 'Messages and push alerts', action: () => navigation.navigate('Notifications') },
    { label: 'Giving history', detail: 'Receipts and pending gifts', action: () => navigation.navigate('GivingHistory') },
    { label: 'Welfare & care', detail: 'Private pastoral support', action: () => navigation.navigate('Welfare') },
    { label: 'Privacy', detail: 'How Altar OS handles your data', action: () => void Linking.openURL('https://altar-os.com/privacy') },
    { label: 'Help centre', detail: 'Get support from our team', action: () => void Linking.openURL('https://altar-os.com/help') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Avatar name={fullName} uri={user?.avatar} size="xl" />
        <Text style={styles.name}>{fullName}</Text>
        <Text style={styles.contact}>{user?.phone || user?.email || 'Member account'}</Text>
        <View style={styles.churchBadge}><Text style={styles.churchText}>{user?.churchName || 'Altar OS member'}</Text></View>
      </View>

      <View style={styles.identityRow}>
        <View><Text style={styles.identityLabel}>ROLE</Text><Text style={styles.identityValue}>{user?.role?.replaceAll('_', ' ') || 'Member'}</Text></View>
        <View style={styles.identityDivider} />
        <View><Text style={styles.identityLabel}>SESSION</Text><Text style={styles.identityValue}>Secured on device</Text></View>
      </View>

      <Text style={styles.sectionTitle}>Account</Text>
      <Card padded={false}>
        {menu.map((item, index) => (
          <TouchableOpacity key={item.label} onPress={item.action} style={[styles.menuRow, index > 0 && styles.menuBorder]} accessibilityRole="button">
            <View style={styles.menuText}><Text style={styles.menuLabel}>{item.label}</Text><Text style={styles.menuDetail}>{item.detail}</Text></View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </Card>

      <View style={styles.logout}>
        <Button title="Sign out" variant="outline" onPress={handleLogout} fullWidth />
        <Text style={styles.version}>ALTAR OS · 1.0.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, paddingBottom: spacing['4xl'] },
  header: { alignItems: 'center', backgroundColor: colors.text, borderRadius: borderRadius['2xl'], padding: spacing['2xl'] },
  name: { color: colors.surface, fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold, marginTop: spacing.md },
  contact: { color: 'rgba(255,255,255,.58)', fontSize: typography.sizes.md, marginTop: spacing.xs },
  churchBadge: { backgroundColor: 'rgba(109,213,196,.14)', borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.md },
  churchText: { color: colors.primaryLight, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium },
  identityRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.xl },
  identityDivider: { width: 1, backgroundColor: colors.border },
  identityLabel: { color: colors.primary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, letterSpacing: 1.2 },
  identityValue: { color: colors.textSecondary, fontSize: typography.sizes.sm, textTransform: 'capitalize', marginTop: 3 },
  sectionTitle: { color: colors.text, fontSize: typography.sizes.xl, fontWeight: typography.weights.bold, marginBottom: spacing.md },
  menuRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.base },
  menuBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  menuText: { flex: 1 },
  menuLabel: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.semibold },
  menuDetail: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 26 },
  logout: { marginTop: spacing['2xl'], alignItems: 'center' },
  version: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.base },
});
