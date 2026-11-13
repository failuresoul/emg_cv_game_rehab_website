import clsx from "clsx";
import { Activity } from "lucide-react";
import { useState } from "react";

import { useEmgStatus } from "@/emg/EmgProvider";
import { EMG_ERROR_KEYS } from "@/emg/messages";
import { t, type TranslationKey } from "@/i18n";

export type DotState = "on" | "paused" | "off";

/** Green streaming, amber connected but not streaming (or just lost), grey off. */
export function dotState(status: {
  connected: boolean;
  streaming: boolean;
  error: string | null;
}): DotState {
  if (status.connected && status.streaming) return "on";
  if (status.connected || status.error === "lost") return "paused";
  return "off";
}

const DOT_CLASSES: Record<DotState, string> = {
  on: "bg-green-400",
  paused: "bg-amber-400",
  off: "bg-gray-400",
};

const DOT_KEYS: Record<DotState, TranslationKey> = {
  on: "emgDot.on",
  paused: "emgDot.paused",
  off: "emgDot.off",
};

/** The session top bar's "Muscle sensor" dot; it opens a small panel with the live checks.
 * Shown when the sensor is in use today, or connected. */
export function EmgStatusDot({ inUse }: { inUse: boolean }) {
  const status = useEmgStatus();
  const [open, setOpen] = useState(false);
  if (!inUse && !status.connected && status.source === null) return null;
  const state = dotState(status);
  const rows: { key: TranslationKey; value: string; ok: boolean | null }[] = [
    { key: "emgDot.source", value: status.source ?? "–", ok: null },
    { key: "emgDot.firmware", value: status.firmwareVersion ?? "–", ok: null },
    {
      key: "emgCheck.rate",
      value: status.sampleRate === null ? "–" : `${status.sampleRate}/s`,
      ok: status.sampleRate !== null,
    },
    { key: "emgCheck.gaps", value: `${status.gapsPct}%`, ok: status.gapsPct < 0.5 },
    {
      key: "emgCheck.contact",
      value: status.electrodeOff ? t("emgDot.flat") : "OK",
      ok: !status.electrodeOff,
    },
    {
      key: "emgCheck.saturation",
      value: status.saturation ? "≥ 3000 mV" : "OK",
      ok: !status.saturation,
    },
    {
      key: "emgDot.level",
      value: status.percentMvc === null ? "–" : `${Math.round(status.percentMvc)}% MVC`,
      ok: null,
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="flex min-h-11 items-center gap-2 rounded-lg px-3 hover:bg-white/10"
      >
        <span aria-hidden className={clsx("size-3 rounded-full", DOT_CLASSES[state])} />
        <span className="text-sm">{t("emgDot.label")}</span>
        <span className="sr-only">{t(DOT_KEYS[state])}</span>
      </button>
      {open && (
        <div className="text-ink absolute right-0 z-20 mt-2 w-72 rounded-xl bg-white p-4 shadow-lg">
          <p className="mb-2 flex items-center gap-2 font-bold">
            <Activity size={18} aria-hidden className="text-primary" />
            {t(DOT_KEYS[state])}
          </p>
          {status.error && (
            <p className="text-danger mb-2 text-sm">{t(EMG_ERROR_KEYS[status.error])}</p>
          )}
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {rows.map(({ key, value, ok }) => (
              <div key={key} className="contents">
                <dt className="text-muted">{t(key)}</dt>
                <dd className={clsx("font-semibold", ok === false && "text-danger")}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
