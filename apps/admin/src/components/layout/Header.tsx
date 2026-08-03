import { useState } from "react";
import { useLocation } from "react-router-dom";
import { AppBar, Avatar, Badge, Box, Divider, IconButton, Menu, MenuItem, Toolbar, Tooltip, Typography } from "@mui/material";
import { KeyboardArrowDownRounded, LogoutRounded, MenuRounded, NotificationsNoneRounded, VerifiedUserRounded } from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";

const titles: Record<string, [string, string]> = {
  "/dashboard": ["Platform overview", "Network performance and operational attention"],
  "/churches": ["Church network", "Tenants, plans and account standing"],
  "/users": ["Platform users", "Identity and access across every church"],
  "/finance": ["Platform finance", "Revenue, plans and church contribution"],
  "/system": ["System health", "Infrastructure status and runtime pressure"],
  "/plans": ["Plans", "Package adoption and activation coverage"],
  "/notifications": ["Notifications", "Operator alerts and delivery posture"],
  "/reports": ["Reports and exports", "Cross-tenant governance summaries"],
  "/access": ["Roles and access", "Privileged identity governance"],
  "/support": ["Support queue", "Church service and escalation ownership"],
  "/audit": ["Audit trail", "Sensitive operator and platform actions"],
  "/integrations": ["Integrations", "External provider readiness"],
  "/settings": ["Platform settings", "Global commercial and operating policy"],
};

export default function Header({ onMenuToggle }: { onMenuToggle: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [accountAnchor, setAccountAnchor] = useState<null | HTMLElement>(null);
  const [noticeAnchor, setNoticeAnchor] = useState<null | HTMLElement>(null);
  const [title, copy] = titles[pathname] ?? ["Platform control", "Altar OS administration"];
  return <AppBar position="sticky" sx={{ px: { xs: 1, md: 2.5 }, pt: { xs: 1, md: 1.5 }, bgcolor: "rgba(7,27,25,.86)", backdropFilter: "blur(18px)" }}><Toolbar disableGutters sx={{ minHeight: 68, px: 1.5, border: "1px solid", borderColor: "divider", bgcolor: "rgba(12,39,36,.88)", borderRadius: 1.5, gap: 1 }}>
    <IconButton onClick={onMenuToggle} aria-label="Open navigation" sx={{ display: { md: "none" } }}><MenuRounded /></IconButton>
    <Box sx={{ minWidth: 0, flex: 1 }}><Typography sx={{ fontSize: ".86rem", fontWeight: 720, lineHeight: 1.2 }}>{title}</Typography><Typography sx={{ display: { xs: "none", sm: "block" }, mt: .25, fontSize: ".65rem", color: "text.secondary" }}>{copy}</Typography></Box>
    <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", gap: .7, mr: 1.2, px: 1.2, py: .65, borderLeft: "1px solid", borderColor: "divider" }}><Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "success.main" }} /><Typography sx={{ fontSize: ".65rem", color: "text.secondary" }}>All core systems normal</Typography></Box>
    <Tooltip title="Operator notices"><IconButton onClick={(event) => setNoticeAnchor(event.currentTarget)}><Badge variant="dot" color="warning"><NotificationsNoneRounded /></Badge></IconButton></Tooltip>
    <Menu anchorEl={noticeAnchor} open={Boolean(noticeAnchor)} onClose={() => setNoticeAnchor(null)} slotProps={{ paper: { sx: { width: 320, mt: 1, p: 1 } } }}><Box sx={{ p: 1.2 }}><Typography sx={{ fontSize: ".8rem", fontWeight: 700 }}>Operator notices</Typography><Typography sx={{ mt: .4, fontSize: ".67rem", color: "text.secondary" }}>No urgent escalations. Scheduled settlement review is due today.</Typography></Box></Menu>
    <Box component="button" type="button" onClick={(event) => setAccountAnchor(event.currentTarget)} sx={{ ml: .2, p: .55, pr: 1, display: "flex", alignItems: "center", gap: 1, border: 0, borderRadius: .8, bgcolor: "transparent", color: "inherit", cursor: "pointer", font: "inherit", "&:hover": { bgcolor: "rgba(255,255,255,.04)" } }}><Avatar variant="rounded" sx={{ width: 36, height: 36, borderRadius: .8, bgcolor: "primary.main", color: "primary.contrastText", fontWeight: 760, fontSize: ".8rem" }}>{user?.name?.charAt(0) ?? "A"}</Avatar><Box sx={{ display: { xs: "none", lg: "block" }, textAlign: "left" }}><Typography sx={{ fontSize: ".72rem", fontWeight: 700 }}>{user?.name ?? "Platform operator"}</Typography><Typography sx={{ fontSize: ".6rem", color: "text.secondary" }}>Super administrator</Typography></Box><KeyboardArrowDownRounded sx={{ display: { xs: "none", sm: "block" }, fontSize: 17, color: "text.secondary" }} /></Box>
    <Menu anchorEl={accountAnchor} open={Boolean(accountAnchor)} onClose={() => setAccountAnchor(null)} transformOrigin={{ horizontal: "right", vertical: "top" }} anchorOrigin={{ horizontal: "right", vertical: "bottom" }} slotProps={{ paper: { sx: { width: 280, mt: 1, p: .8 } } }}><Box sx={{ p: 1.3, borderRadius: .75, bgcolor: "rgba(113,215,197,.08)" }}><Typography sx={{ fontSize: ".8rem", fontWeight: 700 }}>{user?.name ?? "Platform operator"}</Typography><Typography sx={{ mt: .25, fontSize: ".65rem", color: "text.secondary" }}>Privileged production access</Typography></Box><MenuItem sx={{ mt: .5 }}><VerifiedUserRounded sx={{ mr: 1.2, fontSize: 18 }} />Access is audit logged</MenuItem><Divider sx={{ my: .5 }} /><MenuItem onClick={() => { setAccountAnchor(null); logout(); }} sx={{ color: "error.main" }}><LogoutRounded sx={{ mr: 1.2, fontSize: 18 }} />Sign out securely</MenuItem></Menu>
  </Toolbar></AppBar>;
}
