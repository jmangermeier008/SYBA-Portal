import type { SVGProps } from 'react';

/**
 * American football glyph — lucide-react ships no such icon, so this is a
 * hand-drawn SVG matching lucide's conventions (24x24, currentColor stroke,
 * width 2, round caps/joins) so it sits cleanly next to lucide icons.
 */
export function FootballIcon({
  className,
  strokeWidth = 2,
  ...props
}: SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Ball body — a prolate spheroid tilted 45° */}
      <path d="M5.5 18.5C2.5 15.5 2.5 8.5 5.5 5.5s10-3 13 0 3 10 0 13-10 3-13 0Z" />
      {/* Seam down the long axis */}
      <path d="M8 16 16 8" />
      {/* Laces */}
      <path d="M10 13.5 13.5 10" />
      <path d="M9.5 11.5 11 13" />
      <path d="M11 10 12.5 11.5" />
      <path d="M12.5 8.5 14 10" />
    </svg>
  );
}
