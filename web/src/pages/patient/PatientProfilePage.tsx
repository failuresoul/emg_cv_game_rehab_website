import { Hand, Image, Lightbulb, type LucideIcon, Ruler } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { usePatientDashboard } from "@/features/patient/usePatientDashboard";
import { t, type TranslationKey } from "@/i18n";

const CAMERA_TIPS: { textKey: TranslationKey; icon: LucideIcon }[] = [
  { textKey: "patient.profile.tip.distance", icon: Ruler },
  { textKey: "patient.profile.tip.light", icon: Lightbulb },
  { textKey: "patient.profile.tip.visible", icon: Hand },
  { textKey: "patient.profile.tip.background", icon: Image },
];

function Details() {
  const dashboard = usePatientDashboard();

  if (dashboard.isPending) return <Skeleton className="h-24" />;
  if (dashboard.isError) return <QueryError onRetry={() => void dashboard.refetch()} />;

  const { patient_code, affected_side, language } = dashboard.data.profile;
  const details: { labelKey: TranslationKey; value: string }[] = [
    { labelKey: "patient.profile.code", value: patient_code },
    {
      labelKey: "patientForm.affectedSide",
      value: t(affected_side === "left" ? "side.left" : "side.right"),
    },
    {
      labelKey: "patientForm.language",
      value: t(language === "en" ? "language.en" : "language.bn"),
    },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {details.map(({ labelKey, value }) => (
        <div key={labelKey}>
          <dt className="text-muted">{t(labelKey)}</dt>
          <dd className="text-lg font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PatientProfilePage() {
  return (
    <>
      <PageHeader title={t("page.patient.profile.title")} />
      <div className="flex flex-col gap-4">
        <Card>
          <Details />
        </Card>
        <Card>
          <h2 className="mb-4 text-xl font-bold">{t("patient.profile.cameraTips")}</h2>
          <ul className="flex flex-col gap-4">
            {CAMERA_TIPS.map(({ textKey, icon: Icon }) => (
              <li key={textKey} className="flex items-center gap-3">
                <Icon size={28} aria-hidden className="text-primary shrink-0" />
                {t(textKey)}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
