import type { SVGProps } from "react";

/** One stroke family (1.5px, round caps, 20px box) for every icon on the page. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ArrowUpRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6.5 13.5 13.5 6.5M7.5 6.5h6v6" />
  </Icon>
);
export const Close = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);
export const Bag = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 7h11l-.9 9.1a1 1 0 0 1-1 .9H6.4a1 1 0 0 1-1-.9L4.5 7Z" />
    <path d="M7.5 9V5.8a2.5 2.5 0 0 1 5 0V9" />
  </Icon>
);
export const Minus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5.5 10h9" />
  </Icon>
);
export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 5.5v9M5.5 10h9" />
  </Icon>
);
export const Chevron = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m6.5 8 3.5 3.5L13.5 8" />
  </Icon>
);
export const Flask = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 3.5h4M8.5 3.5v4.2L4.4 14.6a1.3 1.3 0 0 0 1.1 1.9h9a1.3 1.3 0 0 0 1.1-1.9l-4.1-6.9V3.5" />
    <path d="M6.2 11.5h7.6" />
  </Icon>
);
export const Book = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 5.8C8.6 4.7 6.6 4.3 4 4.5v10.4c2.6-.2 4.6.2 6 1.3 1.4-1.1 3.4-1.5 6-1.3V4.5c-2.6-.2-4.6.2-6 1.3Z" />
    <path d="M10 5.8v10.4" />
  </Icon>
);
export const Refresh = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M15.5 9.5a5.5 5.5 0 1 1-1.6-3.9M15.5 4.5v3.2h-3.2" />
  </Icon>
);

/** GitHub's mark, filled (the one brand glyph on the page). */
export const GitHub = (p: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.35c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
  </svg>
);

// ── Service marks, one per card on the map ──
export const Globe = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M3.5 10h13M10 3.5c-1.9 1.9-2.8 4.1-2.8 6.5s.9 4.6 2.8 6.5c1.9-1.9 2.8-4.1 2.8-6.5s-.9-4.6-2.8-6.5Z" />
  </Icon>
);
export const Receipt = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5.5 3.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1v-13Z" />
    <path d="M8 7.5h4M8 10.5h4" />
  </Icon>
);
export const Box = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3.5 16 6.5v7l-6 3-6-3v-7l6-3Z" />
    <path d="m4 6.5 6 3 6-3M10 9.5v7" />
  </Icon>
);
export const Card = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="5" width="14" height="10" rx="1.5" />
    <path d="M3 8.5h14M6 12h2.5" />
  </Icon>
);
export const Envelope = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="5" width="14" height="10" rx="1.5" />
    <path d="m3.5 6 6.5 5 6.5-5" />
  </Icon>
);
