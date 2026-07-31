import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  Church as ChurchIcon,
  People as PeopleIcon,
  AttachMoney as FinanceIcon,
  MonitorHeart as HealthIcon,
  AdminPanelSettings as AdminIcon,
} from "@mui/icons-material";

const DRAWER_WIDTH = 260;

const navItems = [
  { label: "Dashboard", icon: <DashboardIcon />, path: "/dashboard" },
  { label: "Churches", icon: <ChurchIcon />, path: "/churches" },
  { label: "Users", icon: <PeopleIcon />, path: "/users" },
  { label: "Finance", icon: <FinanceIcon />, path: "/finance" },
  { label: "System Health", icon: <HealthIcon />, path: "/system" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 3,
          py: 2.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <AdminIcon sx={{ color: "secondary.main", fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight={700} color="text.primary">
            ALTAR OS
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Platform Admin
          </Typography>
        </Box>
      </Box>

      <List sx={{ flex: 1, pt: 2 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              if (isMobile) onClose();
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  if (isMobile) {
    return (
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
      >
        {drawerContent}
      </Drawer>
    );
  }

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": { width: DRAWER_WIDTH },
      }}
    >
      {drawerContent}
    </Drawer>
  );
}
