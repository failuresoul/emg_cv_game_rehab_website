import { getLocale, t } from "@/i18n";

const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 31_536_000 },
  { unit: "month", seconds: 2_592_000 },
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
];

export function formatRelativeTime(iso: string): string {
  const formatter = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  const elapsedSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const { unit, seconds } of UNITS) {
    if (Math.abs(elapsedSeconds) >= seconds) {
      return formatter.format(Math.trunc(elapsedSeconds / seconds), unit);
    }
  }
  return formatter.format(0, "second");
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium" }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Always shows the sign, so that a difference reads clearly. */
export function formatDifference(value: number, digits = 2): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  }).format(value);
}

export function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes === 0) return t("format.seconds", { seconds: remainder });
  if (remainder === 0) return t("format.minutes", { minutes });
  return t("format.minutesSeconds", { minutes, seconds: remainder });
}

/** A running time as minutes and seconds, such as 4:05, in the language's own digits. */
export function formatClock(ms: number, locale: string = getLocale()): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = new Intl.NumberFormat(locale).format(Math.floor(seconds / 60));
  const rest = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(seconds % 60);
  return `${minutes}:${rest}`;
}

/** A short date for chart axes, such as "10 Nov". Accepts a Date or an ISO string. */
export function formatShortDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(getLocale(), { day: "numeric", month: "short" }).format(date);
}
