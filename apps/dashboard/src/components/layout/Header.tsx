import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AppBar, Toolbar, IconButton, Typography, InputBase, Badge, Avatar, Menu, MenuItem,
  Box, ListItemIcon, ListItemText, Divider, Button, CircularProgress, Tooltip,
} from "@mui/material";
import {
  Menu as MenuIcon, SearchRounded, NotificationsNoneRounded, SettingsRounded,
  LogoutRounded, ChevronRightRounded, LanguageRounded, CheckRounded,
  AccountCircleRounded, HelpOutlineRounded, KeyboardCommandKeyRounded,
  MarkEmailReadRounded, ViewSidebarRounded,
} from "@mui/icons-material";
import { alpha, styled } from "@mui/material/styles";
import { initialsOf } from "@/services/auth.service";
import NotificationService from "@/services/notification.service";
import { NotificationStatus, type Notification } from "@altar-os/shared-types";
import { useAuth } from "@/hooks/useAuth";

const Search = styled("div")(({ theme }) => ({
  position: "relative", width: "min(42vw, 520px)", minWidth: 220,
  border: `1px solid ${theme.palette.divider}`, borderRadius: 8,
  backgroundColor: alpha(theme.palette.common.white, .78),
  transition: "border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease",
  "&:focus-within": { borderColor: theme.palette.primary.main, backgroundColor: "#fff", boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main,.09)}` },
}));
const SearchInput = styled(InputBase)(({ theme }) => ({
  width: "100%", "& .MuiInputBase-input": { padding: "10px 46px 10px 42px", fontSize: ".86rem", color: theme.palette.text.primary },
}));

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

interface HeaderProps { onMenuToggle: () => void; sidebarCollapsed: boolean; onExpandSidebar: () => void; }

export default function Header({ onMenuToggle, sidebarCollapsed, onExpandSidebar }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profileAnchor, setProfileAnchor] = useState<null | HTMLElement>(null);
  const [notificationAnchor, setNotificationAnchor] = useState<null | HTMLElement>(null);
  const [languageAnchor, setLanguageAnchor] = useState<null | HTMLElement>(null);
  const [language, setLanguage] = useState("English");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const unread = useMemo(() => notifications.filter((item) => item.status !== NotificationStatus.READ).length, [notifications]);

  useEffect(() => {
    if (!notificationAnchor) return;
    let active = true;
    setLoadingNotifications(true);
    void NotificationService.getNotifications()
      .then((items) => { if (active) setNotifications(items.slice(0, 6)); })
      .catch(() => { if (active) setNotifications([]); })
      .finally(() => { if (active) setLoadingNotifications(false); });
    return () => { active = false; };
  }, [notificationAnchor]);

  const markRead = async (item: Notification) => {
    if (item.status !== NotificationStatus.READ) {
      await NotificationService.markAsRead(item.id).catch(() => undefined);
      setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: NotificationStatus.READ } : entry));
    }
    setNotificationAnchor(null);
  };

  return (
    <AppBar position="sticky" color="transparent" sx={{ px: { xs: 1, md: 2.5 }, pt: { xs: 1, md: 1.5 }, bgcolor: "rgba(238,245,242,.86)", backdropFilter: "blur(18px)" }}>
      <Toolbar disableGutters sx={{ minHeight: { xs: 62, md: 72 }, px: { xs: 1, md: 1.5 }, border: "1px solid", borderColor: "divider", borderRadius: { xs: 1.25, md: 1.75 }, bgcolor: "rgba(251,253,252,.92)", boxShadow: "0 14px 34px rgba(11,46,42,.055)", gap: 1 }}>
        <IconButton aria-label={sidebarCollapsed ? "Expand navigation" : "Toggle navigation"} onClick={sidebarCollapsed ? onExpandSidebar : onMenuToggle} sx={{ ml: .5, display: { xs: "flex", md: sidebarCollapsed ? "flex" : "none" }, color: "text.primary" }}>
          {sidebarCollapsed ? <ViewSidebarRounded /> : <MenuIcon />}
        </IconButton>

        <Box sx={{ pl: { xs: .5, lg: 1.5 }, minWidth: 170, display: { xs: "none", md: "block" } }}>
          <Typography sx={{ fontSize: ".78rem", fontWeight: 700, color: "text.primary" }}>{greeting()}, {user?.name?.split(" ")[0] ?? "there"}</Typography>
          <Typography sx={{ mt: .2, fontSize: ".68rem", color: "text.secondary", display: "flex", alignItems: "center", gap: .7 }}><Box component="span" sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "success.main" }} />Church workspace is live</Typography>
        </Box>

        <Search sx={{ ml: { xs: 0, md: 2 }, flex: { xs: 1, md: "initial" } }}>
          <SearchRounded sx={{ position: "absolute", left: 13, top: 11, fontSize: 20, color: "text.secondary" }} />
          <SearchInput placeholder="Search members, events, giving…" inputProps={{ "aria-label": "Search church workspace" }} />
          <Box sx={{ position: "absolute", right: 10, top: 8, display: { xs: "none", sm: "flex" }, alignItems: "center", gap: .3, px: .8, py: .35, border: "1px solid", borderColor: "divider", borderRadius: 1, color: "text.secondary", fontSize: ".65rem" }}><KeyboardCommandKeyRounded sx={{ fontSize: 11 }} /> K</Box>
        </Search>

        <Box sx={{ flexGrow: 1 }} />

        <Tooltip title="Settings"><IconButton onClick={() => navigate("/settings")} sx={{ display: { xs: "none", sm: "inline-flex" }, bgcolor: "background.default" }}><SettingsRounded fontSize="small" /></IconButton></Tooltip>

        <Tooltip title="Language"><IconButton onClick={(e) => setLanguageAnchor(e.currentTarget)} sx={{ display: { xs: "none", sm: "inline-flex" } }}><LanguageRounded fontSize="small" /></IconButton></Tooltip>
        <Menu anchorEl={languageAnchor} open={Boolean(languageAnchor)} onClose={() => setLanguageAnchor(null)} slotProps={{ paper: { sx: { width: 190, mt: 1.2, p: .7 } } }}>
          {["English", "Twi", "Ga", "Ewe"].map((item) => <MenuItem key={item} selected={language === item} onClick={() => { setLanguage(item); setLanguageAnchor(null); }} sx={{ borderRadius: .75 }}><ListItemText primary={item} secondary={item === "English" ? "Platform default" : "Interface preview"} />{language === item && <CheckRounded color="primary" fontSize="small" />}</MenuItem>)}
        </Menu>

        <Tooltip title="Notifications"><IconButton onClick={(e) => setNotificationAnchor(e.currentTarget)}><Badge badgeContent={unread} color="error" max={9}><NotificationsNoneRounded /></Badge></IconButton></Tooltip>
        <Menu anchorEl={notificationAnchor} open={Boolean(notificationAnchor)} onClose={() => setNotificationAnchor(null)} transformOrigin={{ horizontal: "right", vertical: "top" }} anchorOrigin={{ horizontal: "right", vertical: "bottom" }} slotProps={{ paper: { sx: { width: { xs: "calc(100vw - 24px)", sm: 390 }, mt: 1.2, overflow: "hidden" } } }}>
          <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}><Box><Typography sx={{ fontWeight: 700 }}>Notifications</Typography><Typography variant="caption" color="text.secondary">{unread ? `${unread} need your attention` : "You are all caught up"}</Typography></Box><MarkEmailReadRounded color="primary" /></Box>
          <Divider />
          {loadingNotifications ? <Box sx={{ py: 5, textAlign: "center" }}><CircularProgress size={24} /></Box> : notifications.length ? notifications.map((item) => <MenuItem key={item.id} onClick={() => void markRead(item)} sx={{ alignItems: "flex-start", gap: 1.2, py: 1.35, whiteSpace: "normal", bgcolor: item.status !== NotificationStatus.READ ? "rgba(21,127,115,.055)" : undefined }}><Box sx={{ mt: .7, width: 7, height: 7, flex: "0 0 auto", borderRadius: "50%", bgcolor: item.status !== NotificationStatus.READ ? "primary.main" : "divider" }} /><ListItemText primary={item.title} secondary={item.body} slotProps={{ primary: { sx: { fontSize: ".82rem", fontWeight: 650 } }, secondary: { sx: { mt: .25, fontSize: ".72rem", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } } }} /></MenuItem>) : <Box sx={{ p: 4, textAlign: "center" }}><NotificationsNoneRounded sx={{ color: "primary.main", mb: 1 }} /><Typography sx={{ fontWeight: 650 }}>Nothing waiting</Typography><Typography variant="caption" color="text.secondary">Updates from your church will collect here.</Typography></Box>}
        </Menu>

        <Button onClick={(e) => setProfileAnchor(e.currentTarget)} aria-label="Open account menu" endIcon={<ChevronRightRounded sx={{ transform: profileAnchor ? "rotate(90deg)" : "rotate(0)", transition: "transform 180ms ease" }} />} sx={{ minWidth: 0, ml: .3, px: { xs: .5, sm: 1 }, color: "text.primary", borderRadius: .75 }}>
          <Avatar src={user?.avatarUrl} variant="rounded" sx={{ width: 38, height: 38, bgcolor: "primary.main", fontWeight: 700, borderRadius: 1 }}>{user ? initialsOf(user) : "?"}</Avatar>
          <Box sx={{ display: { xs: "none", lg: "block" }, textAlign: "left", ml: 1.1, minWidth: 112 }}><Typography sx={{ fontSize: ".78rem", fontWeight: 700, lineHeight: 1.2 }}>{user?.name}</Typography><Typography sx={{ fontSize: ".65rem", color: "text.secondary", mt: .25 }}>{user?.role?.replaceAll("_", " ")}</Typography></Box>
        </Button>
        <Menu anchorEl={profileAnchor} open={Boolean(profileAnchor)} onClose={() => setProfileAnchor(null)} transformOrigin={{ horizontal: "right", vertical: "top" }} anchorOrigin={{ horizontal: "right", vertical: "bottom" }} slotProps={{ paper: { sx: { width: 290, mt: 1.2, p: .8 } } }}>
          <Box sx={{ p: 1.4, mb: .5, borderRadius: .75, bgcolor: "primary.dark", color: "white" }}><Typography sx={{ fontWeight: 700 }}>{user?.name}</Typography><Typography sx={{ fontSize: ".7rem", opacity: .62, mt: .3 }}>{user?.email ?? "Church administrator"}</Typography></Box>
          <MenuItem onClick={() => { setProfileAnchor(null); navigate("/settings#profile"); }} sx={{ borderRadius: .75 }}><ListItemIcon><AccountCircleRounded /></ListItemIcon><ListItemText primary="Church profile" secondary="Identity, contacts and branding" /></MenuItem>
          <MenuItem onClick={() => { setProfileAnchor(null); navigate("/settings#security"); }} sx={{ borderRadius: .75 }}><ListItemIcon><SettingsRounded /></ListItemIcon><ListItemText primary="Workspace settings" secondary="Preferences, access and alerts" /></MenuItem>
          <MenuItem onClick={() => { setProfileAnchor(null); navigate("/communications"); }} sx={{ borderRadius: .75 }}><ListItemIcon><HelpOutlineRounded /></ListItemIcon><ListItemText primary="Help & support" secondary="Guides and church support" /></MenuItem>
          <Divider sx={{ my: .7 }} />
          <MenuItem onClick={() => { setProfileAnchor(null); logout(); }} sx={{ borderRadius: .75, color: "error.main" }}><ListItemIcon sx={{ color: "inherit" }}><LogoutRounded /></ListItemIcon><ListItemText primary="Sign out" secondary="End this session securely" /></MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
