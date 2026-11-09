import clsx from "clsx";

import { Badge } from "@/components/ui/Badge";
import { t } from "@/i18n";

import type { ActivationSourceId } from "./types";

interface ActivationMeterProps {
  level: number;
  /** Draws a line at the level to reach, from 0 to 1. */
  demand?: number;
  ready?: boolean;
  className?: string;
}

/** A vertical bar that fills as the hand squeezes. No animation, so it never flashes. */
export function ActivationMeter({ level, demand, ready = true, className }: ActivationMeterProps) {
  const percent = Math.round(Math.min(1, Math.max(0, level)) * 100);
  const reached = demand !== undefined && level >= demand;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={t("input.meter.label", { value: percent })}
      className={clsx(
        "border-primary relative h-48 w-12 overflow-hidden rounded-xl border-2 bg-surface",
        !ready && "opacity-50",
        className,
      )}
    >
      <div
        className={clsx("absolute inset-x-0 bottom-0", reached ? "bg-accent" : "bg-primary")}
        style={{ height: `${percent}%` }}
      />
      {demand !== undefined && (
        <div
          aria-hidden="true"
          className="border-ink absolute inset-x-0 border-t-4 border-dashed"
          style={{ bottom: `${Math.min(1, Math.max(0, demand)) * 100}%` }}
        />
      )}
    </div>
  );
}

/** Shown only while keyboard input stands in for the camera, so it is never left on by mistake. */
export function ActivationSourceBadge({ sourceId }: { sourceId: ActivationSourceId }) {
  if (sourceId !== "keyboard") return null;
  return <Badge variant="warning">{t("input.keyboardBadge")}</Badge>;
}
