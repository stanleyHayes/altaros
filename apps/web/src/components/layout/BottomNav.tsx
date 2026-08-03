import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import BottomNavigation from "@mui/material/BottomNavigation";
import BottomNavigationAction from "@mui/material/BottomNavigationAction";
import Paper from "@mui/material/Paper";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import VolunteerActivismRoundedIcon from "@mui/icons-material/VolunteerActivismRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import ChatRoundedIcon from "@mui/icons-material/ChatRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import ExploreRoundedIcon from "@mui/icons-material/ExploreRounded";
import Menu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";

const navItems = [
  { label: "Home", icon: <HomeRoundedIcon />, path: "/" },
  { label: "Giving", icon: <VolunteerActivismRoundedIcon />, path: "/giving" },
  { label: "Welfare", icon: <FavoriteRoundedIcon />, path: "/welfare" },
  { label: "Social", icon: <ForumRoundedIcon />, path: "/social" },
  { label: "More", icon: <MoreHorizRoundedIcon />, path: "__more__" },
];

const moreMenuItems = [
  { label: "Events", icon: <EventRoundedIcon />, path: "/events" },
  { label: "Chats", icon: <ChatRoundedIcon />, path: "/chats" },
  { label: "Discover", icon: <ExploreRoundedIcon />, path: "/discover" },
  { label: "Profile", icon: <PersonRoundedIcon />, path: "/profile" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [value, setValue] = useState(0);
  const [moreAnchor, setMoreAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    // Check main nav items first
    const index = navItems.findIndex((item) =>
      item.path === "/"
        ? location.pathname === "/"
        : item.path !== "__more__" && location.pathname.startsWith(item.path),
    );
    if (index >= 0) {
      setValue(index);
    } else {
      // Check if current path is in the "More" menu
      const inMore = moreMenuItems.some((item) =>
        location.pathname.startsWith(item.path),
      );
      if (inMore) setValue(navItems.length - 1); // highlight "More"
    }
  }, [location.pathname]);

  return (
    <Paper
      sx={{ display: { xs: "block", md: "none" }, position: "fixed", bottom: { xs: 10, sm: 16 }, left: "50%", transform: "translateX(-50%)", width: "calc(100% - 24px)", maxWidth: 620, zIndex: 1100, borderRadius: 2, bgcolor: "rgba(251,253,251,.94)", backdropFilter: "blur(18px)", overflow: "hidden", boxShadow: "0 18px 50px rgba(11,46,42,.16)" }}
      elevation={0}
    >
      <BottomNavigation
        value={value}
        onChange={(_, newValue) => {
          const item = navItems[newValue];
          if (item.path === "__more__") {
            // Open the more menu — anchor to the last nav action
            const actions = document.querySelectorAll(".MuiBottomNavigationAction-root");
            setMoreAnchor(actions[actions.length - 1] as HTMLElement);
            return;
          }
          setValue(newValue);
          navigate(item.path);
        }}
        showLabels
      >
        {navItems.map((item) => (
          <BottomNavigationAction
            key={item.label}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>

      {/* More menu */}
      <Menu
        anchorEl={moreAnchor}
        open={Boolean(moreAnchor)}
        onClose={() => setMoreAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {moreMenuItems.map((item) => (
          <MuiMenuItem
            key={item.label}
            onClick={() => {
              setMoreAnchor(null);
              navigate(item.path);
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MuiMenuItem>
        ))}
      </Menu>
    </Paper>
  );
}
