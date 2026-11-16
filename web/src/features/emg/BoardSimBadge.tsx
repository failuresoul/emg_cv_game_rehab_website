import clsx from "clsx";
import { FlaskConical } from "lucide-react";

import type { EmgStatus } from "@/emg/engine";
import type { DeviceMode } from "@/emg/protocol";
import { t } from "@/i18n";

/** The real board's mode while it is connected; null for the browser's own simulated sensor
 * (which also says "SIM", but is not the firmware's SIM ON). */
export function boardMode(
  status: Pick<EmgStatus, "connected" | "source" | "mode">,
): DeviceMode | null {
  return status.connected && status.source === "serial" ? status.mode : null;
}

/**
 * "Board simulation": the ESP32 is sending the firmware's own test signal (SIM ON) instead of the
 * sensor's. The data goes through exactly the same path as real data; this badge (and the mode
 * stored with a calibration) is the only difference, so nobody mistakes it for a muscle.
 */
export function BoardSimBadge({
  mode,
  withHint = false,
  className,
}: {
  mode: DeviceMode | null;
  withHint?: boolean;
  className?: string;
}) {
  if (mode !== "SIM") return null;
  return (
    <span className={clsx("inline-flex flex-col gap-1", className)}>
      <span
        data-testid="board-sim-badge"
        className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-300 px-2.5 py-0.5 text-sm font-bold text-black"
      >
        <FlaskConical size={14} aria-hidden />
        {t("emg.boardSimulation")}
      </span>
      {withHint && <span className="text-sm opacity-80">{t("emg.boardSimulation.hint")}</span>}
    </span>
  );
}
