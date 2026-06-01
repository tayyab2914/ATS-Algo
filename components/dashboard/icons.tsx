import type { SVGProps } from "react";
import type { MetricIconKey } from "@/lib/dashboard-data";

/** Shared stroke icon (inherits color via currentColor). */
function Icon({ children, size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.667}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Sidebar nav icons ─────────────────────────────────────────────────────── */
export const NAV_ICONS = {
  dashboard: (p: SVGProps<SVGSVGElement>) => (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  botLibrary: (p: SVGProps<SVGSVGElement>) => (
    <Icon {...p}>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 3v5M8 14h0M16 14h0" />
    </Icon>
  ),
  portfolio: (p: SVGProps<SVGSVGElement>) => (
    <Icon {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
  ),
  myBots: (p: SVGProps<SVGSVGElement>) => (
    <Icon {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
    </Icon>
  ),
  settings: (p: SVGProps<SVGSVGElement>) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  ),
};

/* ── Metric card icons (rendered in accent) ────────────────────────────────── */
const metricIcons: Record<MetricIconKey, (p: SVGProps<SVGSVGElement>) => React.ReactElement> = {
  bot: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 4v4M9 14h0M15 14h0" />
    </Icon>
  ),
  target: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </Icon>
  ),
  barChart: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <path d="M5 20V4M5 20h15" />
      <rect x="9" y="11" width="3" height="6" />
      <rect x="15" y="7" width="3" height="10" />
    </Icon>
  ),
  percent: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <path d="M19 5 5 19" />
      <circle cx="7.5" cy="7.5" r="2" />
      <circle cx="16.5" cy="16.5" r="2" />
    </Icon>
  ),
  shield: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <path d="M12 22s7-3.5 7-9V5l-7-3-7 3v8c0 5.5 7 9 7 9z" />
    </Icon>
  ),
  layers: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <path d="M12 2 3 7l9 5 9-5-9-5z" />
      <path d="M3 12l9 5 9-5M3 17l9 5 9-5" />
    </Icon>
  ),
  trendingUp: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <path d="M3 17 9.5 10.5 13.5 14.5 21 7" />
      <path d="M15 7h6v6" />
    </Icon>
  ),
  activity: (p) => (
    <Icon size={16} strokeWidth={1.333} {...p}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </Icon>
  ),
};

export function MetricIcon({ name, ...props }: { name: MetricIconKey } & SVGProps<SVGSVGElement>) {
  return metricIcons[name](props);
}

/* ── Small tag icons for bot cards ─────────────────────────────────────────── */
export const TAG_ICONS = {
  strategy: (p: SVGProps<SVGSVGElement>) => (
    <Icon size={14} strokeWidth={1.333} {...p}>
      <path d="M3 17 9.5 10.5 13.5 14.5 21 7" />
      <path d="M15 7h6v6" />
    </Icon>
  ),
  clock: (p: SVGProps<SVGSVGElement>) => (
    <Icon size={14} strokeWidth={1.333} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  ),
  risk: (p: SVGProps<SVGSVGElement>) => (
    <Icon size={14} strokeWidth={1.333} {...p}>
      <circle cx="12" cy="12" r="9" />
    </Icon>
  ),
};

export function ChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon size={12} strokeWidth={1.333} {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function TrendArrow({ up, ...props }: { up: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <Icon size={14} strokeWidth={1.5} {...props}>
      {up ? <path d="M3 17 9.5 10.5 13.5 14.5 21 7M15 7h6v6" /> : <path d="M3 7 9.5 13.5 13.5 9.5 21 17M15 17h6v-6" />}
    </Icon>
  );
}
