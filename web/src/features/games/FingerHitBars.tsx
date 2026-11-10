import { t } from "@/i18n";
import type { FingerName } from "@/types/api";

import { FINGER_LABEL_KEYS, percent } from "./results";

/**
 * Small horizontal bars, one per finger, for the share of its notes played. Each row says its
 * finger and percentage in words, so nothing depends on colour or on reading the bar's length.
 */
export function FingerHitBars({
  rates,
  title,
}: {
  rates: readonly { finger: FingerName; rate: number }[];
  title: string;
}) {
  if (rates.length === 0) return null;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-semibold">{title}</figcaption>
      <ul className="flex flex-col gap-2">
        {rates.map(({ finger, rate }) => {
          const value = percent(rate) ?? 0;
          const label = t("history.fingerBar", { finger: t(FINGER_LABEL_KEYS[finger]), value });
          return (
            <li key={finger} className="grid grid-cols-[minmax(7rem,auto)_1fr] items-center gap-3">
              <span className="tabular-nums">{label}</span>
              <span
                role="meter"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
                className="h-4 overflow-hidden rounded-full bg-black/10"
              >
                <span
                  className="bg-primary block h-full rounded-full"
                  style={{ width: `${value}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
