import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";
import type { ReviewFacts } from "@/types/api";

function value(number: number | null | undefined): string {
  if (number === null || number === undefined) return "–";
  return Number.isInteger(number) ? String(number) : formatNumber(number, 2);
}

/** The facts a report may use: numbers and statuses, as the code decided them. */
export function FactsSheet({ facts }: { facts: ReviewFacts }) {
  const metrics = facts.metrics ?? [];
  const games = Object.entries(facts.games ?? {});
  const flags = facts.flags;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">{t("review.facts.session")}</dt>
        <dd>{value(facts.session_no)}</dd>
        <dt className="text-muted">{t("review.facts.baseline")}</dt>
        <dd>{facts.baseline_available ? t("feedback.admin.yes") : t("feedback.admin.no")}</dd>
        <dt className="text-muted">{t("review.facts.notice")}</dt>
        <dd>{facts.safety_notice_present ? t("feedback.admin.yes") : t("feedback.admin.no")}</dd>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="mb-1 text-left font-bold">{t("review.facts.measures")}</caption>
          <thead>
            <tr className="text-muted border-b border-black/10">
              <th scope="col" className="py-1 pr-3">
                {t("review.facts.measure")}
              </th>
              <th scope="col" className="py-1 pr-3">
                {t("review.facts.baselineValue")}
              </th>
              <th scope="col" className="py-1 pr-3">
                {t("review.facts.value")}
              </th>
              <th scope="col" className="py-1 pr-3">
                {t("review.facts.change")}
              </th>
              <th scope="col" className="py-1">
                {t("review.facts.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted py-1">
                  {t("review.facts.none")}
                </td>
              </tr>
            )}
            {metrics.map((metric) => (
              <tr key={`${metric.id}-${metric.game_id ?? ""}`} className="border-b border-black/5">
                <td className="py-1 pr-3">
                  {metric.id} {metric.name}
                  {metric.game_id ? ` (${metric.game_id})` : ""}
                </td>
                <td className="py-1 pr-3 tabular-nums">{value(metric.baseline)}</td>
                <td className="py-1 pr-3 tabular-nums">
                  {value(metric.value)} {metric.unit}
                </td>
                <td className="py-1 pr-3 tabular-nums">{value(metric.change_mdc)}</td>
                <td className="py-1 font-semibold">{metric.mdc_status.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {games.length > 0 && (
        <p>
          <span className="font-bold">{t("review.facts.games")}: </span>
          {games
            .map(
              ([id, game]) =>
                `${id} ${game.trials}× ${value(game.success_rate)}` +
                (game.level_start != null ? ` L${game.level_start}→${game.level_end ?? "?"}` : ""),
            )
            .join("; ")}
        </p>
      )}
      <p>
        <span className="font-bold">{t("review.facts.flags")}: </span>
        {t("review.facts.flagsLine", {
          compensation: value(flags?.compensation_rate),
          shoulder: value(flags?.shoulder_compensation_rate),
          handLost: value(flags?.hand_loss_pct),
          fatigue: flags?.fatigue_flag ? t("feedback.admin.yes") : t("feedback.admin.no"),
          weak: (facts.directions?.weak ?? []).join(", ") || "–",
        })}
      </p>
      {facts.self_report && (
        <p>
          <span className="font-bold">{t("review.facts.selfReport")}: </span>
          {t("review.facts.selfReportLine", {
            pain: facts.self_report.pain_0_10,
            fatigue: facts.self_report.fatigue_0_10,
            enjoyment: facts.self_report.enjoyment_1_5,
          })}
        </p>
      )}
      {facts.adherence && (
        <p>
          <span className="font-bold">{t("review.facts.week")}: </span>
          {facts.adherence.sessions_this_week} / {facts.adherence.planned_this_week}
        </p>
      )}
      <p>
        <span className="font-bold">{t("review.facts.next")}: </span>
        {facts.next_session
          ? [
              facts.next_session.focus_movements.join(", "),
              facts.next_session.focus_directions.join(", "),
              facts.next_session.planned_games.join(", "),
            ]
              .filter(Boolean)
              .join(" · ")
          : "–"}
      </p>
    </div>
  );
}
