import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components/common/Button';
import { Avatar } from '../../components/common/Avatar';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { borderRadius, colors, typography, spacing } from '../../theme';
import socialService, { type PostType } from '../../services/social.service';
import { createSubmissionLock } from '../../services/submission-lock';
import { Ionicons } from '@expo/vector-icons';

export function createPostCompletionBelongsToIdentity(
  mounted: boolean,
  active: { churchId?: string; memberId?: string },
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return mounted
    && active.churchId === startedChurchId
    && active.memberId === startedMemberId;
}

export function CreatePostScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [content, setContent] = useState('');
  const [postType, setPostType] = useState<PostType>('general');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionLock = useRef(createSubmissionLock());
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef({ churchId: user?.churchId, memberId: user?.id });
  const previousIdentityRef = useRef(activeIdentityRef.current);
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.id };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const previous = previousIdentityRef.current;
    const current = activeIdentityRef.current;
    if (previous.churchId !== current.churchId || previous.memberId !== current.memberId) {
      setContent('');
      setPostType('general');
      setIsSubmitting(false);
      submissionLock.current = createSubmissionLock();
      previousIdentityRef.current = current;
    }
  }, [user?.churchId, user?.id]);

  const ownsActiveIdentity = (churchId: string, memberId: string) => (
    createPostCompletionBelongsToIdentity(
      mountedRef.current,
      activeIdentityRef.current,
      churchId,
      memberId,
    )
  );

  const handlePost = async () => {
    if (!content.trim()) {
      Alert.alert('Empty Post', 'Please write something to share.');
      return;
    }
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
    if (!startedChurchId || !startedMemberId) {
      Alert.alert('Post not shared', 'Your member session is incomplete. Sign in again and retry.');
      return;
    }
    const actionLock = submissionLock.current;
    if (!actionLock.acquire()) return;

    setIsSubmitting(true);
    try {
      await socialService.createPost({ content: content.trim(), type: postType }, startedChurchId, startedMemberId);
      if (!ownsActiveIdentity(startedChurchId, startedMemberId)) return;
      Alert.alert('Post shared', 'Your post is now visible to your church community.', [
        {
          text: 'OK',
          onPress: () => {
            if (ownsActiveIdentity(startedChurchId, startedMemberId)) navigation.goBack();
          },
        },
      ]);
    } catch {
      if (startedChurchId && startedMemberId && ownsActiveIdentity(startedChurchId, startedMemberId)) {
        Alert.alert('Post not shared', 'Check your connection and try again.');
      }
    } finally {
      actionLock.release();
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) setIsSubmitting(false);
    }
  };

  const fullName = `${user?.firstName || 'User'} ${user?.lastName || ''}`.trim();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <Avatar name={fullName} uri={user?.avatar} size="md" />
        <View style={styles.userCopy}>
          <Text style={styles.userEyebrow}>SHARING WITH YOUR CHURCH</Text>
          <Text style={styles.userName}>{fullName}</Text>
        </View>
        <View style={styles.communityMark}><Ionicons name="people-outline" size={20} color={colors.primaryDark} /></View>
      </View>

      <View style={styles.typeRow} accessibilityRole="radiogroup" accessibilityLabel="Post type">
        {([
          ['general', 'Post'],
          ['testimony', 'Testimony'],
          ['praise_report', 'Praise report'],
        ] as const).map(([value, label]) => {
          const selected = postType === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.typeChip, selected && styles.typeChipSelected]}
              onPress={() => setPostType(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={label}
            >
              <Text style={[styles.typeText, selected && styles.typeTextSelected]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        style={styles.input}
        placeholder="What's on your heart today?"
        placeholderTextColor={colors.muted}
        value={content}
        onChangeText={setContent}
        multiline
        autoFocus
        textAlignVertical="top"
        maxLength={500}
        accessibilityLabel="Post content"
        accessibilityHint="Share a message of up to 500 characters with your church community"
      />

      <View style={styles.charCount}>
        <Text
          style={[
            styles.charCountText,
            content.length > 500 && styles.charCountOver,
          ]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${500 - content.length} characters remaining`}
        >
          {content.length}/500
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          title="Post"
          onPress={handlePost}
          loading={isSubmitting}
          fullWidth
          size="lg"
          disabled={offline || !content.trim() || content.length > 500}
          accessibilityHint={offline ? 'Reconnect to share this post.' : undefined}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    backgroundColor: colors.text,
    margin: spacing.base,
    borderRadius: borderRadius.xl,
  },
  userCopy: { flex: 1, marginLeft: spacing.md },
  userEyebrow: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: 9, letterSpacing: 1.05, marginBottom: 2 },
  userName: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
    color: colors.surface,
  },
  communityMark: { width: 40, height: 40, borderRadius: borderRadius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.base, paddingTop: spacing.md },
  typeChip: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  typeChipSelected: { backgroundColor: colors.secondaryLight, borderColor: colors.primary },
  typeText: { color: colors.textSecondary, fontFamily: typography.families.medium, fontSize: typography.sizes.sm },
  typeTextSelected: { color: colors.primaryDark, fontFamily: typography.families.semibold },
  input: {
    flex: 1,
    margin: spacing.base,
    padding: spacing.lg,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.lg,
    color: colors.text,
    lineHeight: 26,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  charCount: {
    paddingHorizontal: spacing.base,
    alignItems: 'flex-end',
  },
  charCountText: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
  },
  charCountOver: {
    color: colors.error,
  },
  footer: {
    padding: spacing.base,
    backgroundColor: colors.background,
  },
});
