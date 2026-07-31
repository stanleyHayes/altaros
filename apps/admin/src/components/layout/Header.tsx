import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Avatar,
  Box,
  Menu,
  MenuItem,
} from "@mui/material";
import { Menu as MenuIcon, Logout } from "@mui/icons-material";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

interface HeaderProps {
  onMenuToggle: () => void;
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const { user, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  return (
    <AppBar position="sticky" elevation={0}>
      <Toolbar>
        <IconButton
          edge="start"
          onClick={onMenuToggle}
          sx={{ mr: 2, display: { md: "none" } }}
        >
          <MenuIcon />
        </IconButton>

        <Typography variant="h6" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Platform Admin
        </Typography>

        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer" }}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        >
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: "secondary.main",
              color: "secondary.contrastText",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {user?.name?.charAt(0) ?? "A"}
          </Avatar>
          <Box sx={{ display: { xs: "none", sm: "block" } }}>
            <Typography
              variant="body2"
              color="text.primary"
              sx={{ fontWeight: 600 }}
            >
              {user?.name ?? "Admin"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Super Admin
            </Typography>
          </Box>
        </Box>

        <Menu
          anchorEl={anchorEl}
          open={!!anchorEl}
          onClose={() => setAnchorEl(null)}
        >
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              logout();
            }}
          >
            <Logout sx={{ mr: 1, fontSize: 18 }} />
            Logout
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
