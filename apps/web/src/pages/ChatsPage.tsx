import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export default function ChatsPage() {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "calc(100vh - 128px)",
        textAlign: "center",
        px: 2,
      }}
    >
      <Box sx={{ maxWidth: "400px" }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Group chats coming soon
        </Typography>
        <Typography variant="body1" color="text.secondary">
          We're building group messaging for your church. This feature will let
          you connect with ministry teams and prayer groups.
        </Typography>
      </Box>
    </Box>
  );
}
