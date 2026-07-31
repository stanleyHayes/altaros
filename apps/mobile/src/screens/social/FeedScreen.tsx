import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { Post } from '../../services/social.service';

type FeedNav = NativeStackNavigationProp<RootStackParamList>;

// TODO: Replace with real API data
const mockPosts: Post[] = [
  {
    id: '1',
    content:
      'What an incredible service today! The worship was so uplifting. Grateful for our church family.',
    authorId: 'u1',
    authorName: 'Sarah Johnson',
    likesCount: 24,
    commentsCount: 5,
    isLiked: false,
    createdAt: '2026-03-29T15:30:00Z',
  },
  {
    id: '2',
    content:
      'Prayer group meets every Wednesday at 7 PM. All are welcome! Let us lift each other up in prayer.',
    authorId: 'u2',
    authorName: 'Pastor James',
    likesCount: 45,
    commentsCount: 12,
    isLiked: true,
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: '3',
    content:
      'Just finished reading through the book of Psalms. So many beautiful verses to meditate on.',
    authorId: 'u3',
    authorName: 'Michael Chen',
    likesCount: 18,
    commentsCount: 3,
    isLiked: false,
    createdAt: '2026-03-27T20:15:00Z',
  },
];

export function FeedScreen() {
  const navigation = useNavigation<FeedNav>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Replace with socialService.getFeed()
    const loadFeed = async () => {
      try {
        await new Promise<void>((resolve) => { setTimeout(() => resolve(), 500); });
        setPosts(mockPosts);
      } catch (error) {
        console.error('Failed to load feed:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadFeed();
  }, []);

  const handleLike = (postId: string) => {
    // TODO: Replace with socialService.likePost / unlikePost
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              isLiked: !p.isLiked,
              likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1,
            }
          : p,
      ),
    );
  };

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const renderPost = ({ item }: { item: Post }) => (
    <Card style={styles.postCard}>
      {/* Author Row */}
      <View style={styles.authorRow}>
        <Avatar name={item.authorName} uri={item.authorAvatar} size="md" />
        <View style={styles.authorInfo}>
          <Text style={styles.authorName}>{item.authorName}</Text>
          <Text style={styles.postTime}>{timeAgo(item.createdAt)}</Text>
        </View>
      </View>

      {/* Content */}
      <Text style={styles.postContent}>{item.content}</Text>

      {/* Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleLike(item.id)}
        >
          <Text
            style={[
              styles.actionIcon,
              item.isLiked && styles.actionIconActive,
            ]}
          >
            {item.isLiked ? '\u2665' : '\u2661'}
          </Text>
          <Text
            style={[
              styles.actionText,
              item.isLiked && styles.actionTextActive,
            ]}
          >
            {item.likesCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionIcon}>{'\u2709'}</Text>
          <Text style={styles.actionText}>{item.commentsCount}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.createPostBar}
            onPress={() => navigation.navigate('CreatePost')}
            activeOpacity={0.7}
          >
            <Text style={styles.createPostText}>
              Share something with the community...
            </Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No posts yet. Be the first to share!
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  list: {
    padding: spacing.base,
  },
  createPostBar: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
  },
  createPostText: {
    fontSize: typography.sizes.base,
    color: colors.muted,
  },
  postCard: {
    marginBottom: spacing.md,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  authorInfo: {
    marginLeft: spacing.md,
    flex: 1,
  },
  authorName: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  postTime: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: 1,
  },
  postContent: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.md,
    gap: spacing.xl,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionIcon: {
    fontSize: 18,
    color: colors.muted,
  },
  actionIconActive: {
    color: colors.secondary,
  },
  actionText: {
    fontSize: typography.sizes.md,
    color: colors.muted,
  },
  actionTextActive: {
    color: colors.secondary,
  },
  empty: {
    alignItems: 'center',
    paddingTop: spacing['4xl'],
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.muted,
  },
});
