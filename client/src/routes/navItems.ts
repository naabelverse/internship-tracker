import {
  BoardIcon,
  CalendarIcon,
  DashboardIcon,
  ListIcon,
  SettingsIcon,
} from '@/components/ui/icons';
import { paths } from '@/routes/paths';

export interface NavItem {
  label: string;
  to: string;
  icon: typeof DashboardIcon;
  /** `end` stops `/applications` staying active on its board and calendar children. */
  end: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: paths.dashboard, icon: DashboardIcon, end: true },
  { label: 'Applications', to: paths.applications, icon: ListIcon, end: true },
  { label: 'Board', to: paths.board, icon: BoardIcon, end: false },
  { label: 'Calendar', to: paths.calendar, icon: CalendarIcon, end: false },
  { label: 'Settings', to: paths.settings, icon: SettingsIcon, end: false },
];
