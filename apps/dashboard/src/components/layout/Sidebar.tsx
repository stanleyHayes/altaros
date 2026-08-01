import { useLocation, useNavigate } from 'react-router-dom';
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
} from '@mui/material';
import { Skeleton } from '@mui/material';
import { ChevronLeft as ChevronLeftIcon, Church as ChurchIcon } from '@mui/icons-material';
import { usePermissions, visibleNav } from '@altar-os/permissions';
import { SIDEBAR_ITEMS } from '@/navigation';

const DRAWER_WIDTH = 280;
const DRAWER_WIDTH_COLLAPSED = 72;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({ open, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { permissions, isLoading: permissionsLoading } = usePermissions();

  // Requirement 7, applied to navigation. Filtered from the shared NAV_ITEMS
  // list rather than wrapping each row in <Can>, so anything else built from
  // navigation — a command palette, a "jump to" search, the landing redirect —
  // starts from the same filtered set. An unfiltered list that merely renders
  // nothing still answers "does this church have a Finance section?".
  const navItems = visibleNav(SIDEBAR_ITEMS, permissions);

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
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          px: 2,
          py: 2,
          minHeight: 64,
        }}
      >
        {!collapsed && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <ChurchIcon sx={{ color: 'primary.main', fontSize: 32 }} />
            <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>
              ALTAR OS
            </Typography>
          </Box>
        )}
        {collapsed && <ChurchIcon sx={{ color: 'primary.main', fontSize: 28 }} />}
        {!isMobile && !collapsed && (
          <IconButton size="small" onClick={onToggleCollapse}>
            <ChevronLeftIcon />
          </IconButton>
        )}
      </Box>

      <Divider />

      <List sx={{ flex: 1, px: collapsed ? 0.5 : 1, py: 1 }}>
        {permissionsLoading &&
          // Skeletons, not a spinner: the navigation's shape is known before
          // its contents are, and a spinner here throws away that information
          // to show a shape that tells the reader nothing. Six rows is the
          // most anyone sees, so the list settles by shrinking rather than by
          // pushing the page around as items arrive.
          Array.from({ length: SIDEBAR_ITEMS.length }, (_, i) => (
            <Box
              key={`nav-skeleton-${i}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: collapsed ? 1.5 : 2,
                py: 1.2,
                mb: 0.5,
              }}
            >
              <Skeleton variant="rounded" width={24} height={24} />
              {!collapsed && (
                <Skeleton
                  variant="text"
                  // Varied so the block reads as a list of different labels
                  // rather than a placeholder grid.
                  width={`${55 + ((i * 13) % 35)}%`}
                  sx={{ fontSize: '0.9375rem' }}
                />
              )}
            </Box>
          ))}

        {!permissionsLoading &&
          navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <ListItemButton
                key={item.path}
                selected={isActive}
                onClick={() => handleNavClick(item.path)}
                sx={{
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  px: collapsed ? 1.5 : 2,
                  py: 1.2,
                  mb: 0.5,
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: collapsed ? 0 : 40,
                    justifyContent: 'center',
                    color: isActive ? 'primary.main' : 'text.secondary',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {!collapsed && (
                  <ListItemText
                    primary={item.label}
                    slotProps={{
                      primary: {
                        sx: {
                          fontSize: '0.9375rem',
                          fontWeight: isActive ? 600 : 400,
                        },
                      },
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
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
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
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          // Ease-out rather than MUI's `sharp` (an ease-in-out): the panel
          // should leave immediately and settle, not accelerate into motion.
          // Width is a layout property and normally not worth animating, but
          // here the width IS what changes, so there is nothing cheaper to
          // animate instead.
          transition: theme.transitions.create('width', {
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            duration: theme.transitions.duration.enteringScreen,
          }),
          overflowX: 'hidden',
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
          },
        },
      }}
    >
      {drawerContent}
    </Drawer>
  );
}

export { DRAWER_WIDTH, DRAWER_WIDTH_COLLAPSED };
