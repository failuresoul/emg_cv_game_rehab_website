import { ArrowRight, ClipboardCheck, Table } from "lucide-react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButton } from "@/features/admin/ExportButton";
import { t } from "@/i18n";

/** Data for analysis: CSV exports with patients only by their code. */
export function AdminResearchPage() {
  return (
    <>
      <PageHeader title={t("page.admin.research.title")} description={t("research.intro")} />
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Table size={28} aria-hidden className="text-primary shrink-0" />
          <div>
            <h2 className="text-xl font-bold">{t("research.trialsTitle")}</h2>
            <p className="text-muted">{t("research.trialsDescription")}</p>
          </div>
        </div>
        <div>
          <ExportButton
            path="/admin/export/trials.csv"
            filename="muvi-rehab-trials.csv"
            labelKey="research.exportTrials"
          />
        </div>
      </Card>
      <Card className="mt-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <ClipboardCheck size={28} aria-hidden className="text-primary shrink-0" />
          <div>
            <h2 className="text-xl font-bold">{t("review.title")}</h2>
            <p className="text-muted">{t("review.intro")}</p>
          </div>
        </div>
        <Link
          to="/admin/research/report-review"
          className={buttonClasses("secondary", "md", "self-start")}
        >
          {t("review.open")}
          <ArrowRight size={20} aria-hidden />
        </Link>
      </Card>
    </>
  );
}
