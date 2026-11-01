import { LOCALE } from "@/i18n";

const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 31_536_000 },
  { unit: "month", seconds: 2_592_000 },
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
];

export function formatRelativeTime(iso: string): string {
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const elapsedSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const { unit, seconds } of UNITS) {
    if (Math.abs(elapsedSeconds) >= seconds) {
      return formatter.format(Math.trunc(elapsedSeconds / seconds), unit);
    }
  }
  return formatter.format(0, "second");
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" }).format(new Date(iso));
}
