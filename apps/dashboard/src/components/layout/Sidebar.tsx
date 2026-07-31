import { useLocation, useNavigate } from "react-router-dom";
import {
  Drawer,
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  IconButton,
  Divider,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  AccountBalance as FinanceIcon,
  Event as EventIcon,
  Chat as ChatIcon,
  Analytics as AnalyticsIcon,
  ChevronLeft as ChevronLeftIcon,
  Church as ChurchIcon,
} from "@mui/icons-material";

const DRAWER_WIDTH = 280;
const DRAWER_WIDTH_COLLAPSED = 72;

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: <DashboardIcon /> },
  { label: "Members", path: "/members", icon: <PeopleIcon /> },
  { label: "Finance", path: "/finance", icon: <FinanceIcon /> },
  { label: "Events", path: "/events", icon: <EventIcon /> },
  { label: "Communications", path: "/communications", icon: <ChatIcon /> },
  { label: "Analytics", path: "/analytics", icon: <AnalyticsIcon /> },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const drawerWidth = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  const handleNavClick = (path: string) => {
    navigate(path);
    if (isMobile) {
      onClose();
    }
  };

  const drawerContent = (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          px: 2,
          py: 2,
          minHeight: 64,
        }}
      >
        {!collapsed && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <ChurchIcon sx={{ color: "primary.main", fontSize: 32 }} />
            <Typography variant="h6" color="primary" fontWeight={700}>
              ALTAR OS
            </Typography>
          </Box>
        )}
        {collapsed && (
          <ChurchIcon sx={{ color: "primary.main", fontSize: 28 }} />
        )}
        {!isMobile && !collapsed && (
          <IconButton size="small" onClick={onToggleCollapse}>
            <ChevronLeftIcon />
          </IconButton>
        )}
      </Box>

      <Divider />

      <List sx={{ flex: 1, px: collapsed ? 0.5 : 1, py: 1 }}>
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <ListItemButton
              key={item.path}
              selected={isActive}
              onClick={() => handleNavClick(item.path)}
              sx={{
                justifyContent: collapsed ? "center" : "flex-start",
                px: collapsed ? 1.5 : 2,
                py: 1.2,
                mb: 0.5,
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: collapsed ? 0 : 40,
                  justifyContent: "center",
                  color: isActive ? "primary.main" : "text.secondary",
                }}
              >
                {item.icon}
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontSize: "0.9375rem",
                    fontWeight: isActive ? 600 : 400,
                  }}
                />
              )}
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );

  if (isMobile) {
    return (
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
          },
        }}
      >
        {drawerContent}
      </Drawer>
    );
  }

  return (
    <Drawer
      variant="permanent"
      open
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: drawerWidth,
          boxSizing: "border-box",
          transition: theme.transitions.create("width", {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
          overflowX: "hidden",
        },
      }}
    >
      {drawerContent}
    </Drawer>
  );
}

export { DRAWER_WIDTH, DRAWER_WIDTH_COLLAPSED };
