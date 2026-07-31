import { useNavigate, useLocation } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";

export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/";

  return (
    <AppBar
      position="fixed"
      color="inherit"
      sx={{ bgcolor: "background.paper" }}
    >
      <Toolbar>
        {!isHome && (
          <IconButton
            edge="start"
            onClick={() => navigate(-1)}
            sx={{ mr: 1 }}
          >
            <ArrowBackRoundedIcon />
          </IconButton>
        )}
        <Typography
          variant="h6"
          sx={{
            flexGrow: 1,
            fontWeight: 700,
            color: "primary.main",
          }}
        >
          ALTAR OS
        </Typography>
        <IconButton>
          <Badge badgeContent={3} color="secondary">
            <NotificationsNoneRoundedIcon />
          </Badge>
        </IconButton>
      </Toolbar>
    </AppBar>
  );
}
