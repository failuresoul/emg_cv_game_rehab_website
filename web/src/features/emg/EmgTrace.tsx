import { useEffect, useRef } from "react";

import type { EmgEngine } from "@/emg/engine";
import { SATURATION_MV } from "@/emg/processing";
import { t } from "@/i18n";

const FPS = 15;

/**
 * The muscle signal's last few seconds (the 50 ms smoothed envelope), redrawn about 15 times a
 * second straight from the engine, on the dark session background. The scale follows the signal,
 * so a small resting level is still visible; a dashed line marks a threshold when given.
 */
export function EmgTrace({
  engine,
  seconds = 5,
  thresholdMv = null,
  className,
}: {
  engine: EmgEngine;
  seconds?: number;
  thresholdMv?: number | null;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / FPS) return;
      last = now;
      const element = canvas.current;
      const context = element?.getContext("2d");
      if (!element || !context) return;
      const { width, height } = element;
      context.clearRect(0, 0, width, height);
      const values = engine.recent(seconds).envelope;
      const capacity = Math.round(engine.sampleRateHz * seconds);
      let top = 400;
      for (let index = 0; index < values.length; index += 1)
        top = Math.max(top, values[index]! * 1.15);
      top = Math.min(top, 3300);
      const y = (value: number) => height - (Math.min(top, Math.max(0, value)) / top) * height;
      const x = (index: number) => ((index + capacity - values.length) / capacity) * width;

      context.lineWidth = 1;
      context.setLineDash([6, 6]);
      if (thresholdMv !== null && thresholdMv < top) {
        context.strokeStyle = "rgba(217,104,43,0.9)";
        context.beginPath();
        context.moveTo(0, y(thresholdMv));
        context.lineTo(width, y(thresholdMv));
        context.stroke();
      }
      if (SATURATION_MV < top) {
        context.strokeStyle = "rgba(240,90,80,0.8)";
        context.beginPath();
        context.moveTo(0, y(SATURATION_MV));
        context.lineTo(width, y(SATURATION_MV));
        context.stroke();
      }
      context.setLineDash([]);
      if (values.length < 2) return;
      context.strokeStyle = "#7fd6cc";
      context.lineWidth = 3;
      context.beginPath();
      for (let index = 0; index < values.length; index += 1) {
        if (index === 0) context.moveTo(x(index), y(values[index]!));
        else context.lineTo(x(index), y(values[index]!));
      }
      context.stroke();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, seconds, thresholdMv]);

  return (
    <canvas
      ref={canvas}
      width={900}
      height={220}
      role="img"
      aria-label={t("emg.trace.label", { seconds })}
      className={className ?? "h-44 w-full rounded-xl bg-white/5"}
    />
  );
}
