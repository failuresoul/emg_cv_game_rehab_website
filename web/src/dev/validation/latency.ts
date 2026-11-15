// Development only (/dev/latency, Day 19): the per-frame timing log and its summary.
// Stages: the frame read from the camera (timestamp), the landmarks ready (detectedAt), and the
// square drawn for that frame (renderedAt). The screen's own delay is not visible to software:
// a slow-motion phone video of the square gives the true end-to-end time (latency_manual.csv).

export interface LatencyRow {
  frame: number;
  /** ms since the log started. */
  t_ms: number;
  detect_ms: number;
  render_ms: number;
  total_ms: number;
  /** 1 when the tracked wrist was above the line (the square white). */
  above: 0 | 1;
  fps: number;
}

export interface StageSummary {
  n: number;
  mean: number;
  p95: number;
}

export function summarise(values: readonly number[]): StageSummary {
  if (values.length === 0) return { n: 0, mean: NaN, p95: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const position = 0.95 * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return {
    n: sorted.length,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p95: sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower),
  };
}

export class LatencyLog {
  private readonly rows: LatencyRow[] = [];
  private start: number | null = null;
  /** At most this many frames (about 5 minutes at 30 fps). */
  readonly maxRows: number;

  constructor(maxRows = 9000) {
    this.maxRows = maxRows;
  }

  add(frame: {
    timestamp: number;
    detectedAt: number;
    renderedAt: number;
    above: boolean;
    fps: number;
  }): void {
    if (this.rows.length >= this.maxRows) return;
    this.start ??= frame.timestamp;
    this.rows.push({
      frame: this.rows.length + 1,
      t_ms: round(frame.timestamp - this.start),
      detect_ms: round(frame.detectedAt - frame.timestamp),
      render_ms: round(frame.renderedAt - frame.detectedAt),
      total_ms: round(frame.renderedAt - frame.timestamp),
      above: frame.above ? 1 : 0,
      fps: round(frame.fps),
    });
  }

  get length(): number {
    return this.rows.length;
  }

  summary(): Record<"detect" | "render" | "total", StageSummary> {
    return {
      detect: summarise(this.rows.map((row) => row.detect_ms)),
      render: summarise(this.rows.map((row) => row.render_ms)),
      total: summarise(this.rows.map((row) => row.total_ms)),
    };
  }

  /** The file run_validation.py reads as analysis/validation/latency_software.csv. */
  toCsv(): string {
    const columns: (keyof LatencyRow)[] = [
      "frame",
      "t_ms",
      "detect_ms",
      "render_ms",
      "total_ms",
      "above",
      "fps",
    ];
    return (
      [
        columns.join(","),
        ...this.rows.map((row) => columns.map((column) => row[column]).join(",")),
      ].join("\n") + "\n"
    );
  }

  clear(): void {
    this.rows.length = 0;
    this.start = null;
  }
}

const round = (value: number) => Math.round(value * 100) / 100;
