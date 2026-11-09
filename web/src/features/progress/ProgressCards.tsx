import clsx from "clsx";
import { Check, Flame } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { ProgressChart } from "@/features/patient/ProgressChart";
import { t } from "@/i18n";
import { formatDate, formatNumber, formatShortDate } from "@/lib/format";
import type { CalendarDay, ProgressPoint } from "@/types/api";

import { calendarWeeks, goalShare, localDate, ringDash, trendSeries } from "./progress";

export function StreakCard({ days, className }: { days: number; className?: string }) {
  return (
    <Card
      className={clsx("flex flex-col items-center justify-center gap-2 text-center", className)}
    >
      <Flame size={48} aria-hidden className={days > 0 ? "text-accent" : "text-muted"} />
      <h2 className="text-xl font-bold">{t("patient.streak.title")}</h2>
      <p className="text-4xl font-bold">
        {t(days === 1 ? "patient.streak.day" : "patient.streak.days", { days })}
      </p>
      <p className="text-muted">
        {t(days === 0 ? "patient.streak.empty" : "patient.streak.keepGoing")}
      </p>
    </Card>
  );
}

const RING_RADIUS = 52;
const RING_STROKE = 14;
const RING_SIZE = (RING_RADIUS + RING_STROKE) * 2;

/** A ring that fills as the week's sessions reach the goal. */
export function WeeklyGoalCard({
  done,
  goal,
  className,
}: {
  done: number;
  goal: number;
  className?: string;
}) {
  const share = goalShare(done, goal);
  const centre = RING_SIZE / 2;
  return (
    <Card className={clsx("flex flex-col items-center gap-3 text-center", className)}>
      <h2 className="text-xl font-bold">{t("progress.weekly.title")}</h2>
      <div className="relative">
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          role="img"
          aria-label={t("progress.weekly.value", { done, goal })}
        >
          <circle
            cx={centre}
            cy={centre}
            r={RING_RADIUS}
            fill="none"
            stroke="var(--color-primary-light)"
            strokeWidth={RING_STROKE}
          />
          {share > 0 && (
            <circle
              cx={centre}
              cy={centre}
              r={RING_RADIUS}
              fill="none"
              stroke={share >= 1 ? "var(--color-accent)" : "var(--color-primary)"}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={ringDash(share, RING_RADIUS)}
              transform={`rotate(-90 ${centre} ${centre})`}
            />
          )}
        </svg>
        <p
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-3xl font-bold tabular-nums"
        >
          {t("progress.weekly.short", { done, goal })}
        </p>
      </div>
      <p className="font-medium">
        {t(done >= goal ? "progress.weekly.reached" : "progress.weekly.value", { done, goal })}
      </p>
    </Card>
  );
}

/** The last four weeks, a square per day, filled on days with a completed session. */
export function PracticeCalendar({
  days,
  className,
}: {
  days: readonly CalendarDay[];
  className?: string;
}) {
  const weeks = calendarWeeks(days);
  const practised = days.filter((day) => day.completed > 0).length;
  const last = days[days.length - 1];

  return (
    <Card className={className}>
      <h2 className="mb-1 text-xl font-bold">{t("progress.calendar.title")}</h2>
      <p className="text-muted mb-3">{t("progress.calendar.summary", { count: practised })}</p>
      <table className="w-full table-fixed border-separate border-spacing-1.5">
        <caption className="sr-only">{t("progress.calendar.title")}</caption>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]?.date}>
              {week.map((day) => {
                const date = localDate(day.date);
                const isToday = day === last;
                const label = t(
                  day.completed > 0 ? "progress.calendar.dayDone" : "progress.calendar.dayEmpty",
                  { date: formatDate(date.toISOString()), count: day.completed },
                );
                return (
                  <td key={day.date} className="p-0">
                    <div
                      role="img"
                      aria-label={label}
                      title={label}
                      className={clsx(
                        "flex aspect-square min-h-9 items-center justify-center rounded-lg text-sm font-semibold tabular-nums",
                        day.completed > 0 ? "bg-primary text-white" : "bg-primary-light text-muted",
                        isToday && "outline-accent outline-3 outline-offset-1",
                      )}
                    >
                      {day.completed > 0 ? (
                        <Check size={20} aria-hidden />
                      ) : (
                        <span aria-hidden>{date.getDate()}</span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted mt-2 flex items-center gap-2">
        <span aria-hidden className="outline-accent inline-block size-4 rounded outline-3" />
        {t("progress.calendar.today")}
      </p>
    </Card>
  );
}

/** Reach area, warm-up goals reached and game success, one chart each. */
export function TrendCharts({
  series,
  size,
  className,
}: {
  series: readonly ProgressPoint[];
  size: "sm" | "lg";
  className?: string;
}) {
  const trends = trendSeries(series, formatShortDate);
  const empty = t("progress.trend.empty");
  const charts = [
    {
      key: "reach",
      title: t("progress.trend.reach"),
      chart: (
        <ProgressChart
          points={trends.reachArea}
          seriesName={t("progress.trend.reachSeries")}
          emptyTitle={empty}
          size={size}
          formatValue={(value) => formatNumber(value)}
        />
      ),
    },
    {
      key: "warmup",
      title: t("progress.trend.warmup"),
      chart: (
        <ProgressChart
          points={trends.warmupGoals}
          seriesName={t("progress.trend.warmupSeries")}
          emptyTitle={empty}
          size={size}
          allowDecimals={false}
          formatValue={(value) => formatNumber(value, 0)}
        />
      ),
    },
    {
      key: "games",
      title: t("progress.trend.games"),
      chart: (
        <ProgressChart
          points={trends.successRate}
          seriesName={t("progress.trend.gamesSeries")}
          emptyTitle={empty}
          size={size}
          yDomain={[0, 100]}
          formatValue={(value) => t("patient.lastSession.percent", { value })}
        />
      ),
    },
  ];

  return (
    <div className={className}>
      {charts.map(({ key, title, chart }) => (
        <Card key={key}>
          <h2 className={clsx("mb-2 font-bold", size === "lg" ? "text-xl" : "text-lg")}>{title}</h2>
          {chart}
        </Card>
      ))}
    </div>
  );
}
