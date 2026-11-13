import { InstitutionLogo } from "@/components/brand/Identity";
import { LogoMark } from "@/components/brand/LogoMark";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { type Institution, project } from "@/config/project";
import { LlmHealthCard } from "@/features/feedback/LlmHealthCard";
import { t } from "@/i18n";

function InstitutionCard({ title, institution }: { title: string; institution: Institution }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-muted text-base font-semibold tracking-wide uppercase">{title}</h2>
      <InstitutionLogo institution={institution} />
      <dl className="flex flex-col gap-1">
        <dt className="sr-only">{t("adminSystem.name")}</dt>
        <dd className="font-semibold">{institution.name}</dd>
        {institution.department && (
          <>
            <dt className="sr-only">{t("adminSystem.department")}</dt>
            <dd>{institution.department}</dd>
          </>
        )}
        <dt className="sr-only">{t("adminSystem.country")}</dt>
        <dd className="text-muted">{institution.country}</dd>
      </dl>
    </Card>
  );
}

/** The project's identity and the running version, for admins. */
export function AdminSystemPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.admin.system.title")} />
      <Card className="flex flex-wrap items-center gap-6">
        <LogoMark size={72} />
        <dl className="grid flex-1 gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted font-semibold">{t("adminSystem.project")}</dt>
          <dd>
            <span className="text-primary text-xl font-bold">{project.name}</span>
            <span className="text-muted block">{project.nameLong}</span>
          </dd>
          <dt className="text-muted font-semibold">{t("adminSystem.version")}</dt>
          <dd className="font-mono" data-testid="app-version">
            {project.version}
          </dd>
          <dt className="text-muted font-semibold">{t("adminSystem.research")}</dt>
          <dd>{project.researchTitle}</dd>
        </dl>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <InstitutionCard title={t("adminSystem.institution")} institution={project.institution} />
        <InstitutionCard title={t("adminSystem.collaborator")} institution={project.collaborator} />
      </div>
      <LlmHealthCard />
    </div>
  );
}
