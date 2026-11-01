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
