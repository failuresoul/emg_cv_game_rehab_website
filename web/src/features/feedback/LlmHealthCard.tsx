import { Cpu } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/i18n";

import { useFeedbackHealth } from "./hooks";

/** /admin/system: is the local model reachable and loaded, and how many reports wait. */
export function LlmHealthCard() {
  const health = useFeedbackHealth();
  const yes = t("feedback.admin.yes");
  const no = t("feedback.admin.no");

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Cpu size={24} aria-hidden className="text-primary" />
        {t("feedback.health.title")}
      </h2>
      {health.isPending && <Skeleton className="h-24 rounded-lg" />}
      {health.isError && <QueryError onRetry={() => void health.refetch()} />}
      {health.data && (
        <>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-[auto_1fr]">
            <dt className="text-muted font-semibold">{t("feedback.health.provider")}</dt>
            <dd>{health.data.provider}</dd>
            <dt className="text-muted font-semibold">{t("feedback.health.model")}</dt>
            <dd className="font-mono">{health.data.model}</dd>
            <dt className="text-muted font-semibold">{t("feedback.health.reachable")}</dt>
            <dd>
              <Badge variant={health.data.reachable ? "success" : "danger"}>
                {health.data.reachable ? yes : no}
              </Badge>
            </dd>
            <dt className="text-muted font-semibold">{t("feedback.health.loaded")}</dt>
            <dd>
              <Badge variant={health.data.model_loaded ? "success" : "warning"}>
                {health.data.model_loaded ? yes : no}
              </Badge>
            </dd>
            <dt className="text-muted font-semibold">{t("feedback.health.queue")}</dt>
            <dd className="tabular-nums">{health.data.queue_length}</dd>
          </dl>
          {!health.data.reachable && (
            <p className="text-danger">{t("feedback.health.unreachable")}</p>
          )}
          {health.data.provider === "mock" && (
            <p className="text-muted">{t("feedback.health.mock")}</p>
          )}
        </>
      )}
    </Card>
  );
}
