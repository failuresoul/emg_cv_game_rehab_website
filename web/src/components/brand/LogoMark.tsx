import { LOGO_MARK } from "./logoShapes";

/** The MuVi Rehab mark. Decorative: the name always appears next to it or as a label. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const m = LOGO_MARK;
  return (
    <svg
      viewBox={m.viewBox}
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={className}
      data-testid="logo-mark"
    >
      <rect width={32} height={32} rx={m.radius} fill={m.background} />
      <circle
        cx={m.lens.cx}
        cy={m.lens.cy}
        r={m.lens.r}
        fill="none"
        stroke="#fff"
        strokeWidth={m.stroke}
      />
      <path
        d={m.pulse}
        fill="none"
        stroke="#fff"
        strokeWidth={m.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={m.glint.cx} cy={m.glint.cy} r={m.glint.r} fill={m.accent} />
    </svg>
  );
}
