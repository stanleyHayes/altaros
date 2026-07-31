import { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";

interface PostCardProps {
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  type: string;
  imageUrl?: string;
  likesCount: number;
  commentsCount: number;
  isLikedByMe: boolean;
  createdAt: string;
  onLike: () => void;
  onComment: () => void;
}

const typeLabels: Record<string, string> = {
  testimony: "Testimony",
  praise_report: "Praise Report",
  general: "Post",
};

export default function PostCard({
  authorName,
  authorAvatarUrl,
  content,
  type,
  imageUrl,
  likesCount,
  commentsCount,
  isLikedByMe,
  createdAt,
  onLike,
  onComment,
}: PostCardProps) {
  const [liked, setLiked] = useState(isLikedByMe);
  const [likes, setLikes] = useState(likesCount);

  const handleLike = () => {
    setLiked(!liked);
    setLikes(liked ? likes - 1 : likes + 1);
    onLike();
  };

  return (
    <Card>
      <CardContent sx={{ p: 2.5 }}>
        {/* Author */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
          <Avatar
            src={authorAvatarUrl}
            sx={{ width: 40, height: 40, bgcolor: "primary.main" }}
          >
            {authorName.charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {authorName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {createdAt}
            </Typography>
          </Box>
          {type !== "general" && (
            <Chip
              label={typeLabels[type] || type}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
        </Box>

        {/* Content */}
        <Typography variant="body2" sx={{ mb: imageUrl ? 2 : 1 }}>
          {content}
        </Typography>
      </CardContent>

      {/* Image */}
      {imageUrl && (
        <CardMedia
          component="img"
          image={imageUrl}
          alt="Post image"
          sx={{ maxHeight: 300, objectFit: "cover" }}
        />
      )}

      {/* Actions */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 1,
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <IconButton size="small" onClick={handleLike} color={liked ? "secondary" : "default"}>
            {liked ? (
              <FavoriteRoundedIcon fontSize="small" />
            ) : (
              <FavoriteBorderRoundedIcon fontSize="small" />
            )}
          </IconButton>
          <Typography variant="caption" color="text.secondary">
            {likes}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <IconButton size="small" onClick={onComment}>
            <ChatBubbleOutlineRoundedIcon fontSize="small" />
          </IconButton>
          <Typography variant="caption" color="text.secondary">
            {commentsCount}
          </Typography>
        </Box>
      </Box>
    </Card>
  );
}
