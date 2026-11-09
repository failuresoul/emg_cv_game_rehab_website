import type { CalendarDay, ProgressPoint } from "@/types/api";

/** How this session compares with the last one, or null when there is nothing to compare. */
export type Comparison = "better" | "same" | "lower";

/**
 * When two values count as the same:
 * - "count": only when equal, for small whole numbers such as warm-up goals reached.
 * - "relative": within 5% of the earlier value, for totals and areas.
 * - "share": within 5 percentage points, for shares from 0 to 1.
 */
export type CompareRule = "count" | "relative" | "share";

export const RELATIVE_TOLERANCE = 0.05;
export const SHARE_TOLERANCE = 0.05;

/** Higher is always better for the figures the summary compares. */
export function compare(
  current: number | null | undefined,
  previous: number | null | undefined,
  rule: CompareRule,
): Comparison | null {
  if (current == null || previous == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const difference = current - previous;
  let tolerance = 0;
  if (rule === "share") tolerance = SHARE_TOLERANCE;
  if (rule === "relative") tolerance = Math.abs(previous) * RELATIVE_TOLERANCE;
  // A hair over the tolerance, so floating-point noise at exactly 5% counts as the same.
  if (Math.abs(difference) <= tolerance + 1e-9) return "same";
  return difference > 0 ? "better" : "lower";
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface TrendSeries {
  reachArea: ChartPoint[];
  warmupGoals: ChartPoint[];
  successRate: ChartPoint[];
}

/**
 * The three trend lines, each without the sessions that have nothing for it, such as a session
 * without a calibration. formatLabel turns a session's date into the axis label.
 */
export function trendSeries(
  series: readonly ProgressPoint[],
  formatLabel: (iso: string) => string,
): TrendSeries {
  const reachArea: ChartPoint[] = [];
  const warmupGoals: ChartPoint[] = [];
  const successRate: ChartPoint[] = [];
  for (const point of series) {
    const label = formatLabel(point.date);
    if (point.hull_area_sw2 !== null) {
      reachArea.push({ label, value: Math.round(point.hull_area_sw2 * 100) / 100 });
    }
    if (point.warmup_total > 0) {
      warmupGoals.push({ label, value: point.warmup_goals_reached });
    }
    if (point.game_success_rate !== null) {
      successRate.push({ label, value: Math.round(point.game_success_rate * 100) });
    }
  }
  return { reachArea, warmupGoals, successRate };
}

/** How full the weekly goal ring is, from 0 to 1. */
export function goalShare(done: number, goal: number): number {
  if (goal <= 0) return done > 0 ? 1 : 0;
  return Math.min(Math.max(done / goal, 0), 1);
}

/** The ring's stroke-dasharray for a circle of this radius. */
export function ringDash(share: number, radius: number): string {
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.min(Math.max(share, 0), 1);
  return `${filled} ${circumference - filled}`;
}

/** The calendar split into rows of seven days, oldest first, the last row ending today. */
export function calendarWeeks(days: readonly CalendarDay[]): CalendarDay[][] {
  const weeks: CalendarDay[][] = [];
  for (let start = 0; start < days.length; start += 7) {
    weeks.push(days.slice(start, start + 7));
  }
  return weeks;
}

/** A local date (YYYY-MM-DD) as a Date at local noon, safe from day shifts when formatting. */
export function localDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12);
}

/** Minutes ahead of UTC, as the server expects: Dhaka (UTC+6) is 360. */
export function tzOffsetMinutes(date: Date = new Date()): number {
  // getTimezoneOffset is behind UTC, so Dhaka gives -360. "|| 0" turns -0 into 0.
  return -date.getTimezoneOffset() || 0;
}

export const WEEKLY_GOAL_MIN = 1;
export const WEEKLY_GOAL_MAX = 14;

/** A weekly goal typed by the therapist, or null unless it is a whole number from 1 to 14. */
export function parseWeeklyGoal(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= WEEKLY_GOAL_MIN && value <= WEEKLY_GOAL_MAX ? value : null;
}
