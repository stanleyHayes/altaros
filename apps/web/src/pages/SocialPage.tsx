import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Fab from "@mui/material/Fab";
import Collapse from "@mui/material/Collapse";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import PostCard from "@/components/social/PostCard";
import CommentSection from "@/components/social/CommentSection";
import CreatePostDialog from "@/components/social/CreatePostDialog";
import PageIntro from "@/components/ui/PageIntro";
import { useSnackbar } from "notistack";
import SocialService, { SocialPost, Comment, PostType } from "@/services/social.service";
import { ApiError } from "@/services/api";

type PostComments = Record<string, Comment[]>;

export default function SocialPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [comments, setComments] = useState<PostComments>({});
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postError, setPostError] = useState<string | null>(null);
  const { enqueueSnackbar } = useSnackbar();

  const loadPosts = useCallback(async () => {
    try {
      setLoadingPosts(true);
      setPostError(null);
      const data = await SocialService.getFeed(1);
      setPosts(data.data || []);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to load posts";
      setPostError(message);
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setLoadingPosts(false);
    }
  }, [enqueueSnackbar]);

  // Load posts on mount
  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleCreatePost = async (data: {
    content: string;
    type: string;
    imageUrl?: string;
  }) => {
    try {
      // Cast type string to PostType for API call
      const newPost = await SocialService.createPost({
        content: data.content,
        type: data.type as PostType,
        imageUrl: data.imageUrl,
      });
      // Prepend new post to feed
      setPosts((prev) => [newPost, ...prev]);
      setCreateOpen(false);
      enqueueSnackbar("Post created successfully", { variant: "success" });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to create post";
      enqueueSnackbar(message, { variant: "error" });
    }
  };

  const toggleComments = async (postId: string) => {
    // If already expanded, collapse it
    if (expandedPostId === postId) {
      setExpandedPostId(null);
      return;
    }

    // If not already loaded, fetch comments
    if (!comments[postId]) {
      try {
        const postComments = await SocialService.getComments(postId);
        setComments((prev) => ({
          ...prev,
          [postId]: postComments,
        }));
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Failed to load comments";
        enqueueSnackbar(message, { variant: "error" });
        return;
      }
    }

    setExpandedPostId(postId);
  };

  const handleAddComment = async (postId: string, content: string) => {
    try {
      const newComment = await SocialService.addComment(postId, content);
      setComments((prev) => ({
        ...prev,
        [postId]: [...(prev[postId] || []), newComment],
      }));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to add comment";
      enqueueSnackbar(message, { variant: "error" });
    }
  };

  const handleLikePost = async (postId: string) => {
    try {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;

      if (post.isLikedByMe) {
        await SocialService.unlikePost(postId);
      } else {
        await SocialService.likePost(postId);
      }

      // Update local state
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                isLikedByMe: !p.isLikedByMe,
                likesCount: p.isLikedByMe ? p.likesCount - 1 : p.likesCount + 1,
              }
            : p
        )
      );
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to update like";
      enqueueSnackbar(message, { variant: "error" });
    }
  };

  if (loadingPosts) {
    return (
      <Box sx={{ py: 2, display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ py: 2, position: "relative", minHeight: "80vh" }}>
      <PageIntro eyebrow="Church community" title="Stay connected" copy="Encouragement, testimony and practical updates from people in your church." />

      {postError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPostError(null)}>
          {postError}
        </Alert>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {posts.length === 0 ? (
          <Alert severity="info">No posts yet. Be the first to share your testimony or encouragement!</Alert>
        ) : (
          posts.map((post) => (
            <Box key={post.id}>
              <PostCard
                authorName={post.authorName}
                content={post.content}
                type={post.type}
                likesCount={post.likesCount}
                commentsCount={comments[post.id]?.length ?? post.commentsCount}
                isLikedByMe={post.isLikedByMe}
                createdAt={post.createdAt}
                onLike={() => handleLikePost(post.id)}
                onComment={() => toggleComments(post.id)}
              />
              <Collapse in={expandedPostId === post.id} unmountOnExit>
                <CommentSection
                  comments={comments[post.id] || []}
                  onAddComment={(content) => handleAddComment(post.id, content)}
                />
              </Collapse>
            </Box>
          ))
        )}
      </Box>

      <Fab
        color="primary"
        onClick={() => setCreateOpen(true)}
        sx={{
          position: "fixed",
          bottom: 88,
          right: 20,
        }}
      >
        <AddRoundedIcon />
      </Fab>

      <CreatePostDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreatePost}
      />
    </Box>
  );
}
