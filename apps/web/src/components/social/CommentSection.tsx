import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import SendRoundedIcon from "@mui/icons-material/SendRounded";

interface Comment {
  id: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  createdAt: string;
}

interface CommentSectionProps {
  comments: Comment[];
  onAddComment: (content: string) => void;
}

export default function CommentSection({
  comments,
  onAddComment,
}: CommentSectionProps) {
  const [newComment, setNewComment] = useState("");

  const handleSend = () => {
    if (newComment.trim()) {
      onAddComment(newComment.trim());
      setNewComment("");
    }
  };

  return (
    <Box sx={{ px: 2.5, pb: 2 }}>
      {/* Comments list */}
      {comments.map((comment) => (
        <Box
          key={comment.id}
          sx={{ display: "flex", gap: 1.5, mb: 2 }}
        >
          <Avatar
            src={comment.authorAvatarUrl}
            sx={{ width: 32, height: 32, bgcolor: "primary.light" }}
          >
            {comment.authorName.charAt(0)}
          </Avatar>
          <Box
            sx={{
              bgcolor: "background.default",
              borderRadius: 2,
              px: 2,
              py: 1,
              flex: 1,
            }}
          >
            <Typography variant="caption" fontWeight={600}>
              {comment.authorName}
            </Typography>
            <Typography variant="body2">{comment.content}</Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5, display: "block" }}
            >
              {comment.createdAt}
            </Typography>
          </Box>
        </Box>
      ))}

      {/* Add comment */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Write a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={!newComment.trim()}
        >
          <SendRoundedIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
