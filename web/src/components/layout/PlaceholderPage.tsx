import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { t, type TranslationKey } from "@/i18n";

/** Temporary content for routes that are not built yet. */
export function PlaceholderPage({ titleKey }: { titleKey: TranslationKey }) {
  return (
    <Card>
      <PageHeader title={t(titleKey)} />
      <EmptyState title={t("common.comingSoon")} />
    </Card>
  );
}
