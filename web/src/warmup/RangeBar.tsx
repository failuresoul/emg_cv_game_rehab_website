import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";

/**
 * How far along its range a value is, as a filled bar with a tick at the target. For measures
 * where smaller is better, such as the thumb's touch distance, `invert` fills it from the other end.
 */
export function RangeBar({
  value,
  min,
  max,
  target,
  invert = false,
}: {
  value: number;
  min: number;
  max: number;
  target: number;
  invert?: boolean;
}) {
  const share = (point: number) => {
    const raw = (point - min) / (max - min);
    const clamped = Math.min(1, Math.max(0, raw));
    return invert ? 1 - clamped : clamped;
  };
  const filled = share(value);

  return (
    <div
      role="img"
      aria-label={t("warmup.table.rangeLabel", {
        value: t("warmup.table.percent", { value: formatNumber(filled * 100, 0) }),
      })}
      className="bg-muted/20 relative h-4 w-28 rounded-full"
    >
      <div className="bg-primary h-full rounded-full" style={{ width: `${filled * 100}%` }} />
      <div
        aria-hidden
        className="bg-ink absolute -top-1 h-6 w-0.5"
        style={{ left: `calc(${share(target) * 100}% - 1px)` }}
      />
    </div>
  );
}
