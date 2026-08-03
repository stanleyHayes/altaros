import { useLocation, useNavigate } from "react-router-dom";
import { AppBar, Avatar, Box, IconButton, Toolbar, Typography } from "@mui/material";
import { ArrowBackRounded, NotificationsNoneRounded } from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";
import { firstNameOf } from "@/services/auth.service";

const titles: Record<string, string> = { "/giving": "Giving", "/welfare": "Care & welfare", "/social": "Church community", "/events": "Events", "/chats": "Messages", "/discover": "Discover", "/profile": "Your profile", "/spiritual": "Spiritual life" };

export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const home = pathname === "/";
  return <AppBar position="sticky" color="transparent" sx={{ px: { xs: 1.5, sm: 3, lg: 4 }, pt: 1.5, pb: 2, bgcolor: "rgba(242,246,242,.88)", backdropFilter: "blur(18px)" }}><Toolbar disableGutters sx={{ width: "100%", maxWidth: 1320, mx: "auto", minHeight: 58, px: 1.4, border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "rgba(251,253,251,.92)" }}>
    {!home && <IconButton onClick={() => navigate(-1)} aria-label="Go back" sx={{ mr: .5 }}><ArrowBackRounded /></IconButton>}
    <Box sx={{ flex: 1, minWidth: 0 }}>{home ? <><Typography sx={{ fontSize: ".64rem", color: "primary.main", fontWeight: 750, letterSpacing: ".12em", textTransform: "uppercase" }}>Your church home</Typography><Typography sx={{ fontSize: ".86rem", fontWeight: 720 }}>Good to see you, {user ? firstNameOf(user) : "friend"}</Typography></> : <Typography sx={{ fontSize: ".9rem", fontWeight: 720 }}>{titles[pathname] ?? "Altar OS"}</Typography>}</Box>
    <IconButton aria-label="Notifications"><NotificationsNoneRounded /></IconButton>
    <IconButton onClick={() => navigate("/profile")} aria-label="Open profile" sx={{ ml: .25, p: .4 }}><Avatar variant="rounded" src={user?.avatarUrl} sx={{ width: 34, height: 34, borderRadius: .8, bgcolor: "primary.main", fontSize: ".75rem", fontWeight: 750 }}>{user ? firstNameOf(user).charAt(0) : "A"}</Avatar></IconButton>
  </Toolbar></AppBar>;
}
