import type { SVGProps } from 'react';

/**
 * Hand-drawn 24px stroke icons. The locked stack names no icon library, so these
 * few paths avoid pulling one in for a handful of glyphs. Every icon inherits
 * `currentColor`, which keeps them on theme tokens automatically.
 */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type IconProps = SVGProps<SVGSVGElement>;

export const MenuIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const CloseIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const SunIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
  </Icon>
);

export const MonitorIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <rect x="2.5" y="4" width="19" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);

export const EyeIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.75" />
  </Icon>
);

export const EyeOffIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M10.6 6.2A9.9 9.9 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3.2 3.8M6.3 6.5A17 17 0 002 12s3.6 6 10 6a9.7 9.7 0 004.2-.9" />
    <path d="M3 3l18 18M9.9 9.9a3 3 0 004.2 4.2" />
  </Icon>
);

export const DashboardIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="4.5" rx="1.5" />
    <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Icon>
);

export const ListIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Icon>
);

export const BoardIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
    <rect x="16" y="4" width="5" height="14" rx="1.5" />
  </Icon>
);

export const CalendarIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);

export const SettingsIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-3-1.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004 15a2 2 0 010-4 1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0011 4.4V4a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0020 11a2 2 0 010 4z" />
  </Icon>
);

export const LogOutIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M15 17l5-5-5-5M20 12H9M9 21H6a2 2 0 01-2-2V5a2 2 0 012-2h3" />
  </Icon>
);

export const AlertIcon = (props: IconProps): JSX.Element => (
  <Icon {...props}>
    <path d="M12 3.5L1.8 20.5h20.4L12 3.5z" />
    <path d="M12 10v4M12 17.5h.01" />
  </Icon>
);
