import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Drawer, Box, List, ListItemButton, ListItemIcon, ListItemText, Typography,
  IconButton, useTheme, useMediaQuery, Skeleton, Tooltip, Chip,
} from "@mui/material";
import { ChevronLeftRounded, ChevronRightRounded, AutoAwesomeRounded, SettingsRounded } from "@mui/icons-material";
import { usePermissions, visibleNav } from "@altar-os/permissions";
import { SIDEBAR_ITEMS, type NavItem } from "@/navigation";

const DRAWER_WIDTH = 304;
const DRAWER_WIDTH_COLLAPSED = 84;

interface SidebarProps { open: boolean; onClose: () => void; collapsed: boolean; onToggleCollapse: () => void; }

const sections = [
  { label: "Church pulse", paths: ["/dashboard", "/analytics"] },
  { label: "People & care", paths: ["/members", "/families", "/departments", "/people"] },
  { label: "Ministry work", paths: ["/events", "/live", "/communications", "/ai", "/inter-church"] },
  { label: "Stewardship", paths: ["/finance", "/campaigns"] },
  { label: "Workspace", paths: ["/settings", "/plan"] },
];

/**
 * Anything in NAV_ITEMS that no section claims.
 *
 * Without this a page added to NAV_ITEMS but forgotten here VANISHES: the route
 * works, the permission passes, and the link is simply absent — which is
 * indistinguishable from a permission problem and sends whoever is debugging it
 * to the wrong file. It happened the first time this list was extended.
 *
 * The grouping stays hand-written because the order is an editorial decision,
 * but forgetting it can no longer hide a page.
 */
function ungroupedPaths(items: NavItem[]): string[] {
  const grouped = new Set(sections.flatMap((section) => section.paths));
  return items.filter((item) => !grouped.has(item.path)).map((item) => item.path);
}

function BrandMark() {
  return <Box sx={{ width: 42, height: 42, borderRadius: "14px", bgcolor: "primary.light", color: "primary.dark", display: "grid", placeItems: "center", flex: "0 0 auto" }}><svg width="27" height="27" viewBox="0 0 48 48" fill="none"><path d="M10 31V22C10 14.3 16.3 8 24 8s14 6.3 14 14v9M24 24v14" stroke="currentColor" strokeWidth="6" strokeLinecap="round" /></svg></Box>;
}

export default function Sidebar({ open, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { permissions, isLoading } = usePermissions();
  const items = visibleNav(SIDEBAR_ITEMS, permissions);
  const drawerWidth = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  const go = (path: string) => { navigate(path); if (isMobile) onClose(); };
  const renderItem = (item: NavItem) => {
    const active = location.pathname === item.path || (item.path !== "/dashboard" && location.pathname.startsWith(item.path));
    const button = <ListItemButton key={item.path} selected={active} onClick={() => go(item.path)} sx={{
      mx: collapsed ? .9 : 1.4, mb: .45, minHeight: 46, px: collapsed ? 1 : 1.5,
      justifyContent: collapsed ? "center" : "flex-start", color: active ? "#F4FAF8" : "rgba(225,241,237,.62)",
      position: "relative", overflow: "hidden",
      "&.Mui-selected": { bgcolor: "rgba(109,213,196,.14)", color: "#FFFFFF", "&:hover": { bgcolor: "rgba(109,213,196,.2)" }, "&::before": { content: '""', position: "absolute", left: 0, top: 11, bottom: 11, width: 3, borderRadius: "0 4px 4px 0", bgcolor: "primary.light" } },
      "&:hover": { bgcolor: "rgba(255,255,255,.055)", color: "#FFFFFF" },
    }}>
      <ListItemIcon sx={{ minWidth: collapsed ? 0 : 38, justifyContent: "center", color: active ? "primary.light" : "inherit", "& .MuiSvgIcon-root": { fontSize: 20 } }}>{item.icon}</ListItemIcon>
      {!collapsed && <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: ".82rem", fontWeight: active ? 650 : 500 } } }} />}
      {!collapsed && active && <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "primary.light" }} />}
    </ListItemButton>;
    return collapsed ? <Tooltip key={item.path} title={item.label} placement="right">{button}</Tooltip> : button;
  };

  const content = <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "#0B2E2A", color: "#fff", backgroundImage: "radial-gradient(circle at 0 0, rgba(109,213,196,.12), transparent 28%)" }}>
    <Box sx={{ px: collapsed ? 1.5 : 2.4, pt: 2.2, pb: 1.7, display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.4 }}><BrandMark />{!collapsed && <Box><Typography sx={{ fontSize: "1.05rem", fontWeight: 800, letterSpacing: "-.04em" }}>ALTAR <Box component="span" color="primary.light">OS</Box></Typography><Typography sx={{ mt: .2, fontSize: ".62rem", color: "rgba(225,241,237,.44)", letterSpacing: ".11em", textTransform: "uppercase" }}>Church workspace</Typography></Box>}</Box>
      {!isMobile && !collapsed && <IconButton onClick={onToggleCollapse} aria-label="Collapse navigation" sx={{ color: "rgba(225,241,237,.55)", bgcolor: "rgba(255,255,255,.045)" }}><ChevronLeftRounded /></IconButton>}
    </Box>

    {!collapsed && <Box sx={{ mx: 2.3, mb: 1.6, p: 1.5, borderRadius: 1, bgcolor: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.06)" }}><Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#6DD5C4", boxShadow: "0 0 0 4px rgba(109,213,196,.1)" }} /><Typography sx={{ fontSize: ".72rem", fontWeight: 650 }}>Grace Chapel · Accra</Typography></Box><Typography sx={{ mt: .7, fontSize: ".64rem", color: "rgba(225,241,237,.42)" }}>Pro workspace · All systems ready</Typography></Box>}

    <Box sx={{ flex: 1, overflowY: "auto", pb: 2, scrollbarWidth: "thin", scrollbarColor: "rgba(109,213,196,.2) transparent" }}>
      {isLoading ? <List>{Array.from({ length: 8 }, (_, i) => <Box key={i} sx={{ display: "flex", gap: 1.4, px: 2.4, py: 1.25 }}><Skeleton variant="rounded" width={22} height={22} sx={{ bgcolor: "rgba(255,255,255,.08)" }} />{!collapsed && <Skeleton width={90 + i * 5} sx={{ bgcolor: "rgba(255,255,255,.08)" }} />}</Box>)}</List> :
        [...sections, { label: "More", paths: ungroupedPaths(items) }].map((section) => {
          const group = section.paths.map((path) => items.find((item) => item.path === path)).filter(Boolean) as NavItem[];
          if (!group.length) return null;
          return <Box key={section.label} sx={{ mt: collapsed ? 1 : 1.4 }}>
            {!collapsed && <Typography sx={{ px: 3, mb: .7, fontSize: ".59rem", textTransform: "uppercase", letterSpacing: ".15em", fontWeight: 700, color: "rgba(225,241,237,.34)" }}>{section.label}</Typography>}
            <List disablePadding>{group.map(renderItem)}</List>
          </Box>;
        })}
    </Box>

    <Box sx={{ p: collapsed ? 1 : 1.5, borderTop: "1px solid rgba(255,255,255,.065)" }}>
      {!collapsed && <Box sx={{ p: 1.4, mb: 1, borderRadius: 1, bgcolor: "rgba(109,213,196,.09)" }}><Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><Typography sx={{ fontSize: ".7rem", fontWeight: 700 }}>Workspace health</Typography><Chip label="Ready" size="small" sx={{ height: 22, bgcolor: "rgba(109,213,196,.16)", color: "#BFEDE5", fontSize: ".6rem" }} /></Box><Typography sx={{ mt: .55, fontSize: ".62rem", color: "rgba(225,241,237,.45)" }}>Last sync less than a minute ago</Typography></Box>}
      {!isMobile && collapsed && <Tooltip title="Expand navigation" placement="right"><IconButton onClick={onToggleCollapse} sx={{ width: "100%", color: "primary.light" }}><ChevronRightRounded /></IconButton></Tooltip>}
      {!collapsed && <ButtonLink onClick={() => go("/ai")} icon={<AutoAwesomeRounded />} label="Ask Altar AI" />}
      {!collapsed && <ButtonLink onClick={() => go("/settings")} icon={<SettingsRounded />} label="Settings" />}
    </Box>
  </Box>;

  return <Drawer variant={isMobile ? "temporary" : "permanent"} open={isMobile ? open : true} onClose={onClose} ModalProps={{ keepMounted: true }} sx={{ width: isMobile ? DRAWER_WIDTH : drawerWidth, flexShrink: 0, "& .MuiDrawer-paper": { width: isMobile ? DRAWER_WIDTH : drawerWidth, boxSizing: "border-box", transition: "width 240ms cubic-bezier(.22,1,.36,1)", overflowX: "hidden", "@media (prefers-reduced-motion: reduce)": { transition: "none" } } }}>{content}</Drawer>;
}

function ButtonLink({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return <ListItemButton onClick={onClick} sx={{ minHeight: 40, px: 1.4, color: "rgba(225,241,237,.58)", "&:hover": { bgcolor: "rgba(255,255,255,.05)", color: "#fff" } }}><ListItemIcon sx={{ minWidth: 34, color: "inherit", "& .MuiSvgIcon-root": { fontSize: 18 } }}>{icon}</ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: ".75rem", fontWeight: 600 } } }} /></ListItemButton>;
}

export { DRAWER_WIDTH, DRAWER_WIDTH_COLLAPSED };
