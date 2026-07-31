import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface MenuItem {
  label: string;
  icon: string;
  onPress?: () => void;
  danger?: boolean;
}

// TODO: Replace with real group data from API
const mockGroups = [
  { id: '1', name: 'Worship Team', role: 'Member' },
  { id: '2', name: 'Bible Study Group', role: 'Leader' },
  { id: '3', name: 'Youth Ministry', role: 'Volunteer' },
];

export function ProfileScreen() {
  const { user, logout } = useAuth();

  const fullName =
    `${user?.firstName || 'User'} ${user?.lastName || ''}`.trim();

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  };

  const menuItems: MenuItem[] = [
    { label: 'Edit Profile', icon: '\u270E' },
    { label: 'Notifications', icon: '\u266A' },
    { label: 'Privacy & Security', icon: '\u26BF' },
    { label: 'Giving Statements', icon: '\u2637' },
    { label: 'Help & Support', icon: '\u2753' },
    { label: 'About ALTAR OS', icon: '\u24D8' },
  ];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <Avatar
          name={fullName}
          uri={user?.avatar}
          size="xl"
          style={styles.avatar}
        />
        <Text style={styles.name}>{fullName}</Text>
        <Text style={styles.email}>{user?.email || 'member@church.org'}</Text>
        {user?.phone && <Text style={styles.phone}>{user.phone}</Text>}
        {user?.churchName && (
          <View style={styles.churchBadge}>
            <Text style={styles.churchBadgeText}>{user.churchName}</Text>
          </View>
        )}
      </View>

      {/* Groups */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Groups</Text>
        <Card>
          {mockGroups.map((group, index) => (
            <TouchableOpacity
              key={group.id}
              style={[
                styles.groupItem,
                index < mockGroups.length - 1 && styles.groupItemBorder,
              ]}
            >
              <View>
                <Text style={styles.groupName}>{group.name}</Text>
                <Text style={styles.groupRole}>{group.role}</Text>
              </View>
              <Text style={styles.chevron}>{'\u203A'}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      </View>

      {/* Settings Menu */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>
        <Card padded={false}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={item.label}
              style={[
                styles.menuItem,
                index < menuItems.length - 1 && styles.menuItemBorder,
              ]}
              onPress={item.onPress}
            >
              <View style={styles.menuItemLeft}>
                <Text style={styles.menuIcon}>{item.icon}</Text>
                <Text
                  style={[
                    styles.menuLabel,
                    item.danger && styles.menuLabelDanger,
                  ]}
                >
                  {item.label}
                </Text>
              </View>
              <Text style={styles.chevron}>{'\u203A'}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      </View>

      {/* Logout */}
      <View style={styles.logoutSection}>
        <Button
          title="Log Out"
          variant="outline"
          onPress={handleLogout}
          fullWidth
        />
        <Text style={styles.version}>ALTAR OS v1.0.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  avatar: {
    marginBottom: spacing.base,
  },
  name: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  email: {
    fontSize: typography.sizes.md,
    color: colors.muted,
  },
  phone: {
    fontSize: typography.sizes.md,
    color: colors.muted,
    marginTop: 2,
  },
  churchBadge: {
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginTop: spacing.md,
  },
  churchBadgeText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.medium,
  },
  section: {
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  groupItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  groupItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  groupName: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
    color: colors.text,
  },
  groupRole: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: colors.muted,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIcon: {
    fontSize: 18,
    color: colors.muted,
    marginRight: spacing.md,
    width: 24,
    textAlign: 'center',
  },
  menuLabel: {
    fontSize: typography.sizes.base,
    color: colors.text,
  },
  menuLabelDanger: {
    color: colors.error,
  },
  logoutSection: {
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
    alignItems: 'center',
  },
  version: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: spacing.base,
  },
});
