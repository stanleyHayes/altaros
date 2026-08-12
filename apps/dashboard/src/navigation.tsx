import type { ReactNode } from 'react';
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  AccountBalance as FinanceIcon,
  Event as EventIcon,
  Chat as ChatIcon,
  Analytics as AnalyticsIcon,
  AccountTree as DepartmentsIcon,
  FamilyRestroom as FamiliesIcon,
  AutoAwesome as AiIcon,
  Hub as InterChurchIcon,
  Settings as SettingsIcon,
  Campaign as CampaignIcon,
  Videocam as VideocamIcon,
  CardMembership as PlanIcon,
} from '@mui/icons-material';
import type { NavRequirement } from '@altar-os/permissions';

export interface NavItem extends NavRequirement {
  label: string;
  path: string;
  icon: ReactNode;
  /** Shown in the sidebar. Some routes are reachable but not listed. */
  inSidebar: boolean;
}

/**
 * One list, used by BOTH the sidebar and the route guards.
 *
 * They were separate before, which is the arrangement that eventually ships a
 * hidden nav item whose route still renders — the two drift the first time
 * someone adds a page and updates one of them. Requirement 7 asks for the
 * route not to render *and* the item not to appear; a single source is what
 * makes those the same statement rather than two that happen to agree today.
 *
 * `requires` is the permission needed to SEE the thing at all, which is always
 * the read. Create, update and delete are checked at the control that performs
 * them, with <Can>, because those are per-button rather than per-page.
 */
export const NAV_ITEMS: NavItem[] = [
  // No requirement: the dashboard is the landing page and shows only what its
  // own widgets are permitted to load. Requiring something here would send a
  // narrowly-scoped account to a not-found page immediately after sign-in,
  // which reads as a broken account rather than a narrow one.
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: <DashboardIcon />,
    inSidebar: true,
  },
  {
    label: 'Members',
    path: '/members',
    icon: <PeopleIcon />,
    requires: ['member:read'],
    inSidebar: true,
  },
  {
    label: 'Finance',
    path: '/finance',
    icon: <FinanceIcon />,
    requires: ['finance:read'],
    inSidebar: true,
  },
  {
    label: 'Appeals',
    path: '/campaigns',
    icon: <CampaignIcon />,
    requires: ['finance:read'],
    inSidebar: true,
  },
  {
    // Runs on the event permissions rather than a new resource: a live service
    // IS an event with a camera, and the people who run one are the people who
    // already schedule services.
    label: 'Live',
    path: '/live',
    icon: <VideocamIcon />,
    requires: ['event:read'],
    inSidebar: true,
  },
  {
    label: 'Events',
    path: '/events',
    icon: <EventIcon />,
    requires: ['event:read'],
    inSidebar: true,
  },
  {
    label: 'Communications',
    path: '/communications',
    icon: <ChatIcon />,
    requires: ['communication:read'],
    inSidebar: true,
  },
  {
    label: 'Analytics',
    path: '/analytics',
    icon: <AnalyticsIcon />,
    requires: ['report:read'],
    inSidebar: true,
  },
  {
    label: 'Departments',
    path: '/departments',
    icon: <DepartmentsIcon />,
    requires: ['church:read'],
    inSidebar: true,
  },
  {
    label: 'Families',
    path: '/families',
    icon: <FamiliesIcon />,
    requires: ['member:read'],
    inSidebar: true,
  },
  {
    label: 'AI Assistant',
    path: '/ai',
    icon: <AiIcon />,
    requires: ['member:read'],
    inSidebar: true,
  },
  {
    label: 'Inter-church',
    path: '/inter-church',
    icon: <InterChurchIcon />,
    requires: ['church:read'],
    inSidebar: true,
  },
  {
    label: 'People & Roles',
    path: '/people',
    icon: <PeopleIcon />,
    requires: ['user:read'],
    inSidebar: true,
  },
  {
    // The subscription is a settings decision — it commits the church to a
    // monthly bill and changes the commission on every gift.
    label: 'Plan',
    path: '/plan',
    icon: <PlanIcon />,
    requires: ['settings:read'],
    inSidebar: true,
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: <SettingsIcon />,
    requires: ['settings:read'],
    inSidebar: true,
  },
];

/** The sidebar's subset, in order. */
export const SIDEBAR_ITEMS = NAV_ITEMS.filter((item) => item.inSidebar);

/** The permissions a path requires, or none. */
export function requirementFor(path: string): readonly string[] | undefined {
  return NAV_ITEMS.find((item) => item.path === path)?.requires;
}
