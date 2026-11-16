/**
 * "Record 30 s CSV" on /dev/emg-monitor: a guided protocol (rest, then three cued maximum
 * squeezes), every sample with its phase, written as the CSV analysis/emg/emg_validation.py reads.
 *
 * File format (UTF-8, LF):
 *   # key: value                      metadata lines (firmware, mode, rate, site, label, date)
 *   t_ms,arrival_ms,counter,mv,envelope_mv,phase,cue
 * t_ms is the sample time from the counter (starts at 0); arrival_ms when its chunk reached the
 * browser (from the first sample); phase is rest | mvc1 | mvc2 | mvc3 | relax; cue is 1 on the
 * first sample of each squeeze prompt.
 */

/** A sample as the engine gives it (EngineSample in emg/engine.ts; repeated here so the dev save
 * plugin's tests can import this file without the app's path aliases). */
export interface RecordedSample {
  t: number;
  arrivalMs: number;
  counter: number;
  mv: number;
  envelope: number;
}

export const EMG_CSV_HEADER = "t_ms,arrival_ms,counter,mv,envelope_mv,phase,cue";
export const RECORD_MS = 30_000;

export type RecordPhase = "rest" | "mvc1" | "mvc2" | "mvc3" | "relax";

/** The guided 30 s: 10 s rest, then three 3 s squeezes (each cued) with 3 s to relax between. */
export const PROTOCOL: readonly { from: number; to: number; phase: RecordPhase; cue: boolean }[] = [
  { from: 0, to: 10_000, phase: "rest", cue: false },
  { from: 10_000, to: 13_000, phase: "mvc1", cue: true },
  { from: 13_000, to: 16_000, phase: "relax", cue: false },
  { from: 16_000, to: 19_000, phase: "mvc2", cue: true },
  { from: 19_000, to: 22_000, phase: "relax", cue: false },
  { from: 22_000, to: 25_000, phase: "mvc3", cue: true },
  { from: 25_000, to: RECORD_MS, phase: "relax", cue: false },
];

export function phaseAt(elapsedMs: number): (typeof PROTOCOL)[number] {
  return PROTOCOL.find((step) => elapsedMs >= step.from && elapsedMs < step.to) ?? PROTOCOL.at(-1)!;
}

export interface RecordRow {
  t: number;
  arrival: number;
  counter: number;
  mv: number;
  envelope: number;
  phase: RecordPhase;
  cue: boolean;
}

/** Collects samples from the first one for RECORD_MS of sample time. */
export class EmgRecorder {
  readonly rows: RecordRow[] = [];
  private t0: number | null = null;
  private arrival0 = 0;
  private lastPhase: RecordPhase | null = null;
  private readonly durationMs: number;

  constructor(durationMs = RECORD_MS) {
    this.durationMs = durationMs;
  }

  /** Time recorded so far (ms). */
  get elapsedMs(): number {
    const last = this.rows.at(-1);
    return last ? last.t : 0;
  }

  get done(): boolean {
    return this.elapsedMs >= this.durationMs;
  }

  push(sample: RecordedSample): void {
    if (this.done) return;
    const t0 = this.t0 ?? sample.t;
    if (this.t0 === null) {
      this.t0 = t0;
      this.arrival0 = sample.arrivalMs;
    }
    const t = sample.t - t0;
    if (t >= this.durationMs) {
      this.rows.push({ ...this.row(sample, t), phase: "relax", cue: false });
      return;
    }
    const step = phaseAt(t);
    const cue = step.cue && this.lastPhase !== step.phase;
    this.lastPhase = step.phase;
    this.rows.push({ ...this.row(sample, t), phase: step.phase, cue });
  }

  private row(sample: RecordedSample, t: number) {
    return {
      t,
      arrival: sample.arrivalMs - this.arrival0,
      counter: sample.counter,
      mv: sample.mv,
      envelope: sample.envelope,
    };
  }
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** The CSV text; metadata values have commas and line breaks removed. */
export function toCsv(
  rows: readonly RecordRow[],
  meta: Record<string, string | number | null>,
): string {
  const lines = Object.entries(meta).map(
    ([key, value]) => `# ${key}: ${String(value ?? "").replace(/[\r\n,]+/g, " ")}`,
  );
  lines.push(EMG_CSV_HEADER);
  for (const row of rows) {
    lines.push(
      [
        round(row.t, 2),
        round(row.arrival, 1),
        row.counter,
        row.mv,
        round(row.envelope, 2),
        row.phase,
        row.cue ? 1 : 0,
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** emg-YYYYMMDD-HHMMSS[-label], with only letters, digits, "-" and "_". */
export function recordingName(date: Date, label = ""): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const clean = label
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 40);
  return clean ? `emg-${stamp}-${clean}` : `emg-${stamp}`;
}
