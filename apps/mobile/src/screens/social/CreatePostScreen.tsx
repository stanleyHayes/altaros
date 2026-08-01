import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components/common/Button';
import { Avatar } from '../../components/common/Avatar';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing, borderRadius } from '../../theme';
import socialService from '../../services/social.service';

export function CreatePostScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePost = async () => {
    if (!content.trim()) {
      Alert.alert('Empty Post', 'Please write something to share.');
      return;
    }

    setIsSubmitting(true);
    try {
      await socialService.createPost({ content: content.trim() });
      Alert.alert('Post shared', 'Your post is now visible to your church community.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Post not shared', 'Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
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
        <Text style={styles.userName}>{fullName}</Text>
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
      />

      <View style={styles.charCount}>
        <Text
          style={[
            styles.charCountText,
            content.length > 500 && styles.charCountOver,
          ]}
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
          disabled={!content.trim() || content.length > 500}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  userName: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    marginLeft: spacing.md,
  },
  input: {
    flex: 1,
    padding: spacing.base,
    fontSize: typography.sizes.lg,
    color: colors.text,
    lineHeight: 26,
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
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
