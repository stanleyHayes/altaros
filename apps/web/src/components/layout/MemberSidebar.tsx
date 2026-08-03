import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import {
  AutoStoriesRounded,
  ChatRounded,
  EventRounded,
  ExploreRounded,
  FavoriteRounded,
  ForumRounded,
  HomeRounded,
  LogoutRounded,
  PersonRounded,
  VolunteerActivismRounded,
} from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";
import { firstNameOf } from "@/services/auth.service";

type NavigationItem = {
  label: string;
  path: string;
  icon: ComponentType<SvgIconProps>;
};

const sections: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Your week",
    items: [
      { label: "Home", path: "/", icon: HomeRounded },
      { label: "Spiritual life", path: "/spiritual", icon: AutoStoriesRounded },
    ],
  },
  {
    label: "Church life",
    items: [
      { label: "Giving", path: "/giving", icon: VolunteerActivismRounded },
      { label: "Care & welfare", path: "/welfare", icon: FavoriteRounded },
      { label: "Events", path: "/events", icon: EventRounded },
    ],
  },
  {
    label: "Community",
    items: [
      { label: "Social", path: "/social", icon: ForumRounded },
      { label: "Messages", path: "/chats", icon: ChatRounded },
      { label: "Discover", path: "/discover", icon: ExploreRounded },
    ],
  },
];

export const MEMBER_SIDEBAR_WIDTH = 276;

export default function MemberSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const firstName = user ? firstNameOf(user) : "Member";

  const isActive = (path: string) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path);

  return (
    <Box
      component="aside"
      sx={{
        display: { xs: "none", md: "flex" },
        width: MEMBER_SIDEBAR_WIDTH,
        height: "100dvh",
        flex: `0 0 ${MEMBER_SIDEBAR_WIDTH}px`,
        position: "sticky",
        top: 0,
        flexDirection: "column",
        bgcolor: "#0B2E2A",
        color: "#F5F8F6",
        borderRight: "1px solid rgba(109,213,196,.16)",
        backgroundImage:
          "radial-gradient(circle at 0 0, rgba(109,213,196,.14), transparent 29%)",
      }}
    >
      <Box sx={{ px: 3, pt: 3.2, pb: 2.8 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.4 }}>
          <Box
            aria-hidden
            sx={{
              width: 42,
              height: 42,
              borderRadius: "13px",
              bgcolor: "#6DD5C4",
              color: "#0B2E2A",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Box component="svg" viewBox="0 0 48 48" sx={{ width: 27, height: 27, fill: "none" }}>
              <path d="M10 31V22C10 14.3 16.3 8 24 8s14 6.3 14 14v9M24 24v14" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
            </Box>
          </Box>
          <Box>
            <Typography sx={{ fontSize: "1.04rem", fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1 }}>
              ALTAR <Box component="span" sx={{ color: "#6DD5C4" }}>OS</Box>
            </Typography>
            <Typography sx={{ mt: .55, fontSize: ".6rem", color: "rgba(235,246,242,.46)", letterSpacing: ".14em" }}>
              MEMBER HOME
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mx: 2.2, mb: 2.4, px: 1.7, py: 1.5, border: "1px solid rgba(255,255,255,.08)", bgcolor: "rgba(255,255,255,.035)", borderRadius: "9px" }}>
        <Typography sx={{ fontSize: ".72rem", fontWeight: 700 }}>{firstName}&apos;s church home</Typography>
        <Typography sx={{ mt: .45, color: "rgba(235,246,242,.48)", fontSize: ".64rem" }}>Connected and ready for the week</Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: 1.4 }}>
        {sections.map((section) => (
          <Box key={section.label} sx={{ mb: 2.1 }}>
            <Typography sx={{ px: 1.6, mb: .7, color: "rgba(235,246,242,.35)", fontSize: ".58rem", fontWeight: 750, letterSpacing: ".15em", textTransform: "uppercase" }}>
              {section.label}
            </Typography>
            <List disablePadding>
              {section.items.map(({ label, path, icon: Icon }) => {
                const active = isActive(path);
                return (
                  <ListItemButton
                    key={path}
                    selected={active}
                    onClick={() => navigate(path)}
                    sx={{
                      minHeight: 44,
                      mb: .35,
                      px: 1.5,
                      borderRadius: "8px",
                      color: active ? "#FFFFFF" : "rgba(235,246,242,.61)",
                      "&.Mui-selected": {
                        bgcolor: "rgba(109,213,196,.14)",
                        "&:hover": { bgcolor: "rgba(109,213,196,.19)" },
                      },
                      "&:hover": { bgcolor: "rgba(255,255,255,.05)", color: "#FFFFFF" },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 37, color: active ? "#6DD5C4" : "inherit" }}>
                      <Icon sx={{ fontSize: 19 }} />
                    </ListItemIcon>
                    <ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: ".78rem", fontWeight: active ? 700 : 520 } } }} />
                    {active && <Box sx={{ width: 4, height: 18, borderRadius: "4px", bgcolor: "#6DD5C4" }} />}
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      <Box sx={{ p: 1.8, borderTop: "1px solid rgba(255,255,255,.075)" }}>
        <ListItemButton onClick={() => navigate("/profile")} selected={pathname.startsWith("/profile")} sx={{ px: 1.3, borderRadius: "8px", color: "rgba(235,246,242,.68)", "&.Mui-selected": { bgcolor: "rgba(109,213,196,.14)", color: "#fff" } }}>
          <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}><PersonRounded sx={{ fontSize: 19 }} /></ListItemIcon>
          <ListItemText primary="Your profile" slotProps={{ primary: { sx: { fontSize: ".76rem", fontWeight: 650 } } }} />
        </ListItemButton>
        <Button
          fullWidth
          onClick={() => { logout(); navigate("/login"); }}
          startIcon={<LogoutRounded />}
          sx={{ mt: .5, justifyContent: "flex-start", px: 1.3, color: "rgba(235,246,242,.48)", fontSize: ".73rem", "&:hover": { color: "#fff", bgcolor: "rgba(255,255,255,.05)" } }}
        >
          Sign out
        </Button>
      </Box>
    </Box>
  );
}
