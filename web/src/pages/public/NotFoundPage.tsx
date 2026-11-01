import { SearchX } from "lucide-react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { t } from "@/i18n";

export function NotFoundPage() {
  return (
    <Card>
      <PageHeader title={t("page.public.notFound.title")} />
      <EmptyState
        icon={SearchX}
        title={t("page.public.notFound.description")}
        action={
          <Link to="/" className={buttonClasses("primary")}>
            {t("page.public.notFound.action")}
          </Link>
        }
      />
    </Card>
  );
}
