import { useState } from "react";
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  InputBase,
  Badge,
  Avatar,
  Menu,
  MenuItem,
  Box,
  ListItemIcon,
  ListItemText,
  Divider,
} from "@mui/material";
import { alpha, styled } from "@mui/material/styles";
import {
  Menu as MenuIcon,
  Search as SearchIcon,
  Notifications as NotificationsIcon,
  Person as PersonIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  ChevronRight as ExpandIcon,
} from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";

const Search = styled("div")(({ theme }) => ({
  position: "relative",
  borderRadius: theme.shape.borderRadius,
  backgroundColor: alpha(theme.palette.common.black, 0.04),
  "&:hover": {
    backgroundColor: alpha(theme.palette.common.black, 0.06),
  },
  marginRight: theme.spacing(2),
  marginLeft: 0,
  width: "100%",
  maxWidth: 400,
  [theme.breakpoints.up("sm")]: {
    marginLeft: theme.spacing(3),
  },
}));

const SearchIconWrapper = styled("div")(({ theme }) => ({
  padding: theme.spacing(0, 2),
  height: "100%",
  position: "absolute",
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: theme.palette.text.secondary,
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: "inherit",
  width: "100%",
  "& .MuiInputBase-input": {
    padding: theme.spacing(1, 1, 1, 0),
    paddingLeft: `calc(1em + ${theme.spacing(4)})`,
    transition: theme.transitions.create("width"),
    fontSize: "0.9375rem",
  },
}));

interface HeaderProps {
  onMenuToggle: () => void;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
}

export default function Header({
  onMenuToggle,
  sidebarCollapsed,
  onExpandSidebar,
}: HeaderProps) {
  const { user, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleMenuClose();
    logout();
  };

  const userInitials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : "?";

  return (
    <AppBar
      position="sticky"
      color="inherit"
      sx={{
        bgcolor: "background.paper",
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <Toolbar>
        <IconButton
          edge="start"
          color="inherit"
          aria-label="toggle menu"
          onClick={sidebarCollapsed ? onExpandSidebar : onMenuToggle}
          sx={{ mr: 1, display: { md: sidebarCollapsed ? "flex" : "none", xs: "flex" } }}
        >
          {sidebarCollapsed ? <ExpandIcon /> : <MenuIcon />}
        </IconButton>

        <Search>
          <SearchIconWrapper>
            <SearchIcon />
          </SearchIconWrapper>
          <StyledInputBase
            placeholder="Search..."
            inputProps={{ "aria-label": "search" }}
          />
        </Search>

        <Box sx={{ flexGrow: 1 }} />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton size="large" aria-label="notifications" color="inherit">
            <Badge badgeContent={3} color="error">
              <NotificationsIcon />
            </Badge>
          </IconButton>

          <IconButton
            size="small"
            onClick={handleProfileMenuOpen}
            aria-label="account menu"
            sx={{ ml: 1 }}
          >
            <Avatar
              src={user?.avatarUrl}
              sx={{
                width: 36,
                height: 36,
                bgcolor: "primary.main",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              {userInitials}
            </Avatar>
          </IconButton>

          {user && (
            <Box sx={{ display: { xs: "none", sm: "block" }, ml: 1 }}>
              <Typography variant="body2" fontWeight={600} lineHeight={1.2}>
                {user.firstName} {user.lastName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.role}
              </Typography>
            </Box>
          )}
        </Box>

        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
          slotProps={{
            paper: {
              sx: { width: 200, mt: 1 },
            },
          }}
        >
          <MenuItem onClick={handleMenuClose}>
            <ListItemIcon>
              <PersonIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Profile</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleMenuClose}>
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Settings</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout}>
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Logout</ListItemText>
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
