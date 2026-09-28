import type { JSX } from "preact";

type P = { size?: number } & JSX.SVGAttributes<SVGSVGElement>;

function Svg({ size = 16, children, ...rest }: P & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconOpen = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
    <path d="M3 7v11a2 2 0 0 0 2 2h13l3-9H7l-3 9" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconEyeOff = (p: P) => (
  <Svg {...p}>
    <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9" />
    <path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="M3 3l18 18" />
  </Svg>
);
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 2 8l10 5 10-5-10-5z" />
    <path d="m2 13 10 5 10-5" />
    <path d="m2 17.5 10 5 10-5" opacity=".5" />
  </Svg>
);
export const IconTree = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="10" width="7" height="5" rx="1" />
    <rect x="14" y="17" width="7" height="4" rx="1" />
    <path d="M6.5 8v10.5H14M6.5 12.5H14" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const IconPointer = (p: P) => (
  <Svg {...p}>
    <path d="M5 3l14 7-6 2-2 6L5 3z" />
  </Svg>
);
export const IconRuler = (p: P) => (
  <Svg {...p}>
    <path d="M3 17 17 3l4 4L7 21l-4-4z" />
    <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
  </Svg>
);
export const IconSection = (p: P) => (
  <Svg {...p}>
    <path d="M3 21 21 3" stroke-dasharray="3 3" />
    <rect x="3" y="15" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
  </Svg>
);
export const IconCube = (p: P) => (
  <Svg {...p}>
    <path d="M12 2 3 7v10l9 5 9-5V7l-9-5z" />
    <path d="m3 7 9 5 9-5M12 12v10" />
  </Svg>
);
export const IconSquare = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 12h16M12 4v16" opacity=".45" />
  </Svg>
);
export const IconFit = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);
export const IconHelp = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 4" />
    <path d="M12 17.5h.01" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);
export const IconHighlight = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <rect x="13" y="13" width="8" height="8" rx="1" />
    <rect x="13" y="3" width="8" height="8" rx="1" opacity=".4" />
    <rect x="3" y="13" width="8" height="8" rx="1" opacity=".4" />
  </Svg>
);
export const IconEnter = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
    <path d="M3 12h11M10 8l4 4-4 4" />
  </Svg>
);
export const IconPanel = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);
export const IconPanelRight = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v6M12 7.5h.01" />
  </Svg>
);
export const IconGrid = (p: P) => (
  <Svg {...p}>
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </Svg>
);
export const IconTag = (p: P) => (
  <Svg {...p}>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
    <circle cx="8" cy="8" r="1.5" />
  </Svg>
);
export const IconFill = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="1.5" />
    <path d="M3 9l6-6M3 15 15 3M3 21 21 3M9 21l12-12M15 21l6-6" opacity=".6" />
  </Svg>
);
export const IconLogo = (p: P) => (
  <svg width={p.size ?? 22} height={p.size ?? 22} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--accent)" />
    <path d="M9 9h9v5H9zM14 18h9v5h-9z" fill="none" stroke="#fff" stroke-width="2" />
    <path d="M13.5 14v4" stroke="#fff" stroke-width="2" />
  </svg>
);
