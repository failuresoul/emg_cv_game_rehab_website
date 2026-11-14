import { t } from "@/i18n";

const SIZE = 176;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The large rep count, inside a ring that fills as reps are done. */
export function RepCounterRing({ current, total }: { current: number; total: number }) {
  const share = total > 0 ? Math.min(1, current / total) : 0;

  return (
    <div className="relative mx-auto size-44 shrink-0">
      {/* Read out at each new rep: live regions announce their text, not a changed label. */}
      <span role="status" className="sr-only">
        {t("warmup.counter", { current, total })}
      </span>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="size-full -rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-muted)"
          strokeOpacity={0.25}
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - share)}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <div aria-hidden className="absolute inset-0 flex items-baseline justify-center pt-11">
        <span className="text-primary text-7xl leading-none font-bold">
          {t("warmup.counterCurrent", { current })}
        </span>
        <span className="text-muted ml-1 text-xl font-semibold">
          {t("warmup.counterTotal", { total })}
        </span>
      </div>
    </div>
  );
}
