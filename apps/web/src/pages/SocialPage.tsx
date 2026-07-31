import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Fab from "@mui/material/Fab";
import Collapse from "@mui/material/Collapse";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import PostCard from "@/components/social/PostCard";
import CommentSection from "@/components/social/CommentSection";
import CreatePostDialog from "@/components/social/CreatePostDialog";

interface Comment {
  id: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  createdAt: string;
}

// Mock comments keyed by post ID
const mockComments: Record<string, Comment[]> = {
  "1": [
    {
      id: "c1",
      authorName: "Michael Brown",
      content: "So happy for you, Sarah! God is good!",
      createdAt: "1 hour ago",
    },
    {
      id: "c2",
      authorName: "Lisa Chen",
      content: "Congratulations! What a testimony!",
      createdAt: "45 min ago",
    },
  ],
  "2": [
    {
      id: "c3",
      authorName: "Grace Okonkwo",
      content: "That sermon changed my perspective too. So powerful.",
      createdAt: "4 hours ago",
    },
  ],
  "3": [
    {
      id: "c4",
      authorName: "David Williams",
      content: "Praise God! Praying for a full recovery.",
      createdAt: "20 hours ago",
    },
    {
      id: "c5",
      authorName: "Sarah Johnson",
      content: "Wonderful news! God answers prayers.",
      createdAt: "18 hours ago",
    },
    {
      id: "c6",
      authorName: "Pastor James",
      content: "We continue to keep your mother in our prayers.",
      createdAt: "16 hours ago",
    },
  ],
};

// TODO: Replace with actual API data
const mockPosts = [
  {
    id: "1",
    authorName: "Sarah Johnson",
    content:
      "God has been so faithful! After months of searching, I finally got the job I prayed for. Never give up on God's timing!",
    type: "testimony" as const,
    likesCount: 24,
    commentsCount: 8,
    isLikedByMe: false,
    createdAt: "2 hours ago",
  },
  {
    id: "2",
    authorName: "David Williams",
    content:
      "Sunday's sermon on walking in faith really spoke to me. I've been meditating on Hebrews 11:1 all week. What a powerful word!",
    type: "general" as const,
    likesCount: 15,
    commentsCount: 3,
    isLikedByMe: true,
    createdAt: "5 hours ago",
  },
  {
    id: "3",
    authorName: "Grace Okonkwo",
    content:
      "Praise the Lord! My mother's surgery went well and she is recovering. Thank you all for your prayers.",
    type: "praise_report" as const,
    likesCount: 42,
    commentsCount: 12,
    isLikedByMe: false,
    createdAt: "Yesterday",
  },
];

export default function SocialPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [comments, setComments] =
    useState<Record<string, Comment[]>>(mockComments);

  const handleCreatePost = async (data: {
    content: string;
    type: string;
    imageUrl?: string;
  }) => {
    // TODO: Call SocialService.createPost(data)
    console.log("Post created:", data);
  };

  const toggleComments = (postId: string) => {
    setExpandedPostId((prev) => (prev === postId ? null : postId));
  };

  const handleAddComment = (postId: string, content: string) => {
    const newComment: Comment = {
      id: `c${Date.now()}`,
      authorName: "You",
      content,
      createdAt: "Just now",
    };
    setComments((prev) => ({
      ...prev,
      [postId]: [...(prev[postId] || []), newComment],
    }));
  };

  return (
    <Box sx={{ py: 2, position: "relative", minHeight: "80vh" }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
        Community
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {mockPosts.map((post) => (
          <Box key={post.id}>
            <PostCard
              authorName={post.authorName}
              content={post.content}
              type={post.type}
              likesCount={post.likesCount}
              commentsCount={
                (comments[post.id]?.length ?? 0) || post.commentsCount
              }
              isLikedByMe={post.isLikedByMe}
              createdAt={post.createdAt}
              onLike={() => {
                // TODO: Call SocialService.likePost / unlikePost
              }}
              onComment={() => toggleComments(post.id)}
            />
            <Collapse in={expandedPostId === post.id} unmountOnExit>
              <CommentSection
                comments={comments[post.id] || []}
                onAddComment={(content) => handleAddComment(post.id, content)}
              />
            </Collapse>
          </Box>
        ))}
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
