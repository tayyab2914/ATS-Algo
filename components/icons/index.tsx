import type { SVGProps } from "react";

/**
 * Feature-card glyphs. Drawn at a 24px viewBox and rendered at 14px to match
 * the design. Stroke uses `currentColor` so the parent controls colour via
 * `text-accent`, keeping the icons theme-aware.
 */

const baseProps: SVGProps<SVGSVGElement> = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function BotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="4" y="9" width="16" height="11" rx="2.5" />
      <path d="M12 4.5v4.5" />
      <circle cx="12" cy="3.5" r="1.4" />
      <path d="M9 14.5h0M15 14.5h0" />
    </svg>
  );
}

export function BarChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 20V4M5 20h15" />
      <rect x="9" y="11" width="3" height="6" />
      <rect x="15" y="7" width="3" height="10" />
    </svg>
  );
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 21.5s7-3.5 7-9V5.2L12 2.5 5 5.2V12.5c0 5.5 7 9 7 9z" />
      <path d="M9 11.5l2 2 4-4" />
    </svg>
  );
}

/** Registry mapping a feature's icon name to its component. */
export const FEATURE_ICONS = {
  bot: BotIcon,
  chart: BarChartIcon,
  shield: ShieldIcon,
} as const;

export type FeatureIconName = keyof typeof FEATURE_ICONS;
