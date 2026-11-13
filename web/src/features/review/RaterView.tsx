import { CheckCircle2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { FeedbackReportView } from "@/features/feedback/FeedbackReportView";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { BlindItem } from "@/types/api";

import { FactsSheet } from "./FactsSheet";
import { nextUnrated, useRateItem, useReviewItem, useReviewItems } from "./hooks";
import { RubricForm } from "./RubricForm";

/** One report, blind: its code, the facts sheet beside the report, and the rubric. Nothing
 * says which version it is: the server never sends it. */
export function BlindItemView({ item, rubric }: { item: BlindItem; rubric: ReactNode }) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1fr_1fr]">
      <Card className="flex flex-col gap-3">
        <h3 className="text-lg font-bold">
          {t("review.item", { code: item.code, position: item.position, total: item.total })}
        </h3>
        {item.report ? (
          <FeedbackReportView report={item.report} notices={item.safety_notices} />
        ) : (
          <EmptyState title={t("feedback.error")} />
        )}
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <h3 className="mb-2 text-lg font-bold">{t("review.facts.title")}</h3>
          <FactsSheet facts={item.facts} />
        </Card>
        <Card>{rubric}</Card>
      </div>
    </div>
  );
}

/** Rate the set's reports one at a time, in their shuffled order. */
export function RaterView({ setId }: { setId: number }) {
  const items = useReviewItems(setId, true);
  const [chosen, setChosen] = useState<string | null>(null);
  const code = chosen ?? (items.data ? nextUnrated(items.data, null) : null);
  const item = useReviewItem(setId, code);
  const rate = useRateItem(setId);

  if (items.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (items.isError) return <QueryError onRetry={() => void items.refetch()} />;
  const done = items.data.filter((entry) => entry.rated_by_me).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="font-semibold" role="status">
        {t("review.progress", { done, total: items.data.length })}
      </p>
      <nav aria-label={t("review.itemsLabel")} className="flex flex-wrap gap-2">
        {items.data.map((entry) => (
          <button
            key={entry.code}
            type="button"
            aria-current={entry.code === code ? "true" : undefined}
            onClick={() => setChosen(entry.code)}
            className={`min-h-11 rounded-lg border px-3 font-mono ${
              entry.code === code ? "border-primary bg-primary-light" : "border-black/15"
            }`}
          >
            {entry.rated_by_me && (
              <CheckCircle2 size={16} aria-hidden className="text-success mr-1 inline" />
            )}
            {entry.code}
          </button>
        ))}
      </nav>
      {code === null && <EmptyState icon={CheckCircle2} title={t("review.allDone")} />}
      {code !== null && item.isPending && <Skeleton className="h-96 rounded-xl" />}
      {item.isError && <QueryError onRetry={() => void item.refetch()} />}
      {item.data && (
        <BlindItemView
          item={item.data}
          rubric={
            item.data.my_rating ? (
              <p className="text-success font-semibold">
                {t("review.rated", { date: formatDateTime(item.data.my_rating.created_at) })}
              </p>
            ) : (
              <RubricForm
                key={item.data.code}
                code={item.data.code}
                pending={rate.isPending}
                error={rate.isError ? t("review.saveError") : null}
                onSubmit={(rating) =>
                  rate.mutate(
                    { code: item.data.code, rating },
                    {
                      onSuccess: () =>
                        setChosen(
                          nextUnrated(
                            items.data.map((entry) =>
                              entry.code === item.data.code
                                ? { ...entry, rated_by_me: true }
                                : entry,
                            ),
                            item.data.code,
                          ),
                        ),
                    },
                  )
                }
              />
            )
          }
        />
      )}
    </div>
  );
}
