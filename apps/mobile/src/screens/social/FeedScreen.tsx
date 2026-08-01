import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { Post } from '../../services/social.service';
import socialService from '../../services/social.service';

type FeedNav = NativeStackNavigationProp<RootStackParamList>;

export function FeedScreen() {
  const navigation = useNavigation<FeedNav>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadFeed = async (refresh = false) => {
    refresh ? setRefreshing(true) : setIsLoading(true);
    setError('');
    try {
      const result = await socialService.getFeed({ limit: 30 });
      setPosts(result.posts);
    } catch {
      setError('We could not load the community feed.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void loadFeed(); }, []);

  const handleLike = async (post: Post) => {
    setPosts((current) => current.map((item) => item.id === post.id ? { ...item, isLiked: !item.isLiked, likesCount: item.likesCount + (item.isLiked ? -1 : 1) } : item));
    try {
      const result = post.isLiked ? await socialService.unlikePost(post.id) : await socialService.likePost(post.id);
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, likesCount: result.likesCount } : item));
    } catch {
      setPosts((current) => current.map((item) => item.id === post.id ? post : item));
      setError('Your reaction was not saved. Try again.');
    }
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
          onPress={() => void handleLike(item)}
          accessibilityRole="button"
          accessibilityLabel={item.isLiked ? 'Unlike post' : 'Like post'}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadFeed(true)} tintColor={colors.primary} />}
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
              {error || 'No posts yet. Be the first to share.'}
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
