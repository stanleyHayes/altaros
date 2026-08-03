import { useLocation, useNavigate } from "react-router-dom";
import { Box, Chip, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Typography, useMediaQuery, useTheme } from "@mui/material";
import { AccountBalanceRounded, AdminPanelSettingsRounded, AssessmentRounded, ChurchRounded, DashboardRounded, Groups2Rounded, HistoryRounded, IntegrationInstructionsRounded, ManageAccountsRounded, MonitorHeartRounded, NotificationsActiveRounded, SettingsRounded, SupportAgentRounded, WorkspacePremiumRounded } from "@mui/icons-material";

export const DRAWER_WIDTH = 286;
const sections = [
  { label: "Command", items: [{ label: "Platform overview", icon: DashboardRounded, path: "/dashboard" }, { label: "Notifications", icon: NotificationsActiveRounded, path: "/notifications" }, { label: "Reports & exports", icon: AssessmentRounded, path: "/reports" }, { label: "System health", icon: MonitorHeartRounded, path: "/system" }] },
  { label: "Network", items: [{ label: "Churches", icon: ChurchRounded, path: "/churches" }, { label: "Platform users", icon: Groups2Rounded, path: "/users" }, { label: "Roles & access", icon: ManageAccountsRounded, path: "/access" }] },
  { label: "Commercial", items: [{ label: "Finance", icon: AccountBalanceRounded, path: "/finance" }, { label: "Plans", icon: WorkspacePremiumRounded, path: "/plans" }] },
  { label: "Trust & service", items: [{ label: "Support queue", icon: SupportAgentRounded, path: "/support" }, { label: "Audit trail", icon: HistoryRounded, path: "/audit" }] },
  { label: "System", items: [{ label: "Integrations", icon: IntegrationInstructionsRounded, path: "/integrations" }, { label: "Platform settings", icon: SettingsRounded, path: "/settings" }] },
];

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("md"));
  const go = (path: string) => { navigate(path); if (mobile) onClose(); };
  const content = <Box sx={{ minHeight: "100%", display: "flex", flexDirection: "column", backgroundImage: "radial-gradient(circle at 0 0, rgba(113,215,197,.1), transparent 27%)" }}>
    <Box sx={{ px: 2.5, pt: 2.5, pb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.4 }}><Box sx={{ width: 42, height: 42, borderRadius: 1.25, bgcolor: "primary.main", color: "primary.contrastText", display: "grid", placeItems: "center" }}><AdminPanelSettingsRounded /></Box><Box><Typography sx={{ fontWeight: 800, letterSpacing: "-.04em" }}>ALTAR <Box component="span" color="primary.main">OS</Box></Typography><Typography sx={{ fontSize: ".6rem", color: "text.secondary", letterSpacing: ".14em", textTransform: "uppercase" }}>Platform control</Typography></Box></Box>
      <Box sx={{ mt: 2.4, p: 1.5, border: "1px solid", borderColor: "divider", bgcolor: "rgba(255,255,255,.025)", borderRadius: 1 }}><Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Typography sx={{ fontSize: ".72rem", fontWeight: 680 }}>Production</Typography><Chip label="Live" size="small" color="success" /></Box><Typography sx={{ mt: .6, fontSize: ".63rem", color: "text.secondary" }}>Ghana region · Primary cluster</Typography></Box>
    </Box>
    <Box component="nav" aria-label="Platform administration" sx={{ flex: 1, overflowY: "auto", px: 1.2 }}>
      {sections.map((section) => <Box key={section.label} sx={{ mb: 2.2 }}><Typography variant="overline" sx={{ display: "block", px: 1.5, mb: .7, color: "rgba(145,170,165,.5)" }}>{section.label}</Typography><List disablePadding>{section.items.map(({ label, path, icon: Icon }) => { const active = location.pathname === path; return <ListItemButton key={path} selected={active} onClick={() => go(path)} sx={{ minHeight: 44, mb: .4, px: 1.35, color: active ? "text.primary" : "text.secondary", position: "relative", "&.Mui-selected": { bgcolor: "rgba(113,215,197,.11)", "&:hover": { bgcolor: "rgba(113,215,197,.15)" }, "&::before": { content: '""', position: "absolute", left: 0, top: 10, bottom: 10, width: 3, bgcolor: "primary.main" } }, "&:hover": { bgcolor: "rgba(255,255,255,.035)", color: "text.primary" } }}><ListItemIcon sx={{ minWidth: 37, color: active ? "primary.main" : "inherit" }}><Icon sx={{ fontSize: 20 }} /></ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: ".8rem", fontWeight: active ? 680 : 520 } } }} /></ListItemButton>; })}</List></Box>)}
    </Box>
    <Box sx={{ p: 2, borderTop: "1px solid", borderColor: "divider" }}><Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "success.main", boxShadow: "0 0 0 4px rgba(113,215,162,.08)" }} /><Box><Typography sx={{ fontSize: ".69rem", fontWeight: 680 }}>Operator channel secure</Typography><Typography sx={{ fontSize: ".59rem", color: "text.secondary" }}>Role and audit controls active</Typography></Box></Box></Box>
  </Box>;
  return <Drawer variant={mobile ? "temporary" : "permanent"} open={mobile ? open : true} onClose={onClose} ModalProps={{ keepMounted: true }} sx={{ width: DRAWER_WIDTH, flexShrink: 0, "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" } }}>{content}</Drawer>;
}
