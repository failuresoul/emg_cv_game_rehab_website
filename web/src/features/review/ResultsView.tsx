import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { t, type TranslationKey } from "@/i18n";
import { downloadFile } from "@/lib/download";
import { formatNumber } from "@/lib/format";
import type { ReviewResults, ReviewVersionSummary } from "@/types/api";

import { useReviewResults } from "./hooks";
import { DIMENSIONS, RUBRIC } from "./RubricForm";

const VERSIONS: { key: keyof ReviewResults["versions"]; label: TranslationKey }[] = [
  { key: "llm", label: "review.results.llm" },
  { key: "llm_model_written", label: "review.results.llmModelWritten" },
  { key: "template", label: "review.results.template" },
];

function meanCell(summary: ReviewVersionSummary, dimension: (typeof DIMENSIONS)[number]): string {
  const mean = summary.means[dimension];
  if (mean === null || mean === undefined) return "–";
  const sd = summary.sds[dimension];
  return sd === null || sd === undefined
    ? formatNumber(mean, 2)
    : `${formatNumber(mean, 2)} (${formatNumber(sd, 2)})`;
}

/** The comparison: means (SD) per version and dimension, % unsafe, rater agreement, export. */
export function ResultsView({ setId }: { setId: number }) {
  const results = useReviewResults(setId);
  const showToast = useToast();
  const [exporting, setExporting] = useState(false);

  if (results.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (results.isError) return <QueryError onRetry={() => void results.refetch()} />;
  const data = results.data;

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadFile(
        `/admin/review-sets/${setId}/export.csv`,
        `muvi-report-review-${setId}.csv`,
      );
    } catch {
      showToast("error", t("review.results.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold">{t("review.results.title")}</h3>
          <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
            <Download size={20} aria-hidden />
            {t("review.results.export")}
          </Button>
        </div>
        <p className="text-muted">
          {t("review.results.fallbacks", { count: data.llm_fallbacks, items: data.items / 2 })}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-muted border-b border-black/10">
                <th scope="col" className="py-2 pr-4">
                  {t("review.results.version")}
                </th>
                <th scope="col" className="py-2 pr-4">
                  {t("review.results.ratings")}
                </th>
                {DIMENSIONS.map((dimension) => (
                  <th key={dimension} scope="col" className="py-2 pr-4">
                    {t(RUBRIC[dimension].name)}
                  </th>
                ))}
                <th scope="col" className="py-2">
                  {t("review.results.unsafe")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {VERSIONS.map(({ key, label }) => {
                const summary = data.versions[key];
                return (
                  <tr key={key}>
                    <th scope="row" className="py-2 pr-4 font-semibold">
                      {t(label)}
                    </th>
                    <td className="py-2 pr-4 tabular-nums">{summary.ratings}</td>
                    {DIMENSIONS.map((dimension) => (
                      <td key={dimension} className="py-2 pr-4 tabular-nums">
                        {meanCell(summary, dimension)}
                      </td>
                    ))}
                    <td className="py-2 tabular-nums">
                      {summary.unsafe_pct === null
                        ? "–"
                        : `${formatNumber(summary.unsafe_pct, 1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <h3 className="text-lg font-bold">{t("review.results.agreement")}</h3>
        <p className="text-muted">{t("review.results.agreementHint")}</p>
        {data.agreement.length === 0 ? (
          <p>{t("review.results.noAgreement")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-muted border-b border-black/10">
                  <th scope="col" className="py-2 pr-4">
                    {t("review.results.dimension")}
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    {t("review.results.raters")}
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    {t("review.results.items")}
                  </th>
                  <th scope="col" className="py-2">
                    κ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {data.agreement.map((row) => (
                  <tr key={`${row.dimension}-${row.rater_a}-${row.rater_b}`}>
                    <td className="py-2 pr-4">
                      {row.dimension === "unsafe"
                        ? t("review.results.unsafe")
                        : t(RUBRIC[row.dimension].name)}
                    </td>
                    <td className="py-2 pr-4">
                      {row.rater_a} · {row.rater_b}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{row.items}</td>
                    <td className="py-2 tabular-nums">
                      {row.kappa === null ? "–" : formatNumber(row.kappa, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
