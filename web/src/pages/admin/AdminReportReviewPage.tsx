import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueryError } from "@/components/ui/QueryError";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useCreateReviewSet, useReviewSets } from "@/features/review/hooks";
import { RaterView } from "@/features/review/RaterView";
import { ResultsView } from "@/features/review/ResultsView";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { Language, ReviewSetRead } from "@/types/api";

function CreateSetForm({ onCreated }: { onCreated: (id: number) => void }) {
  const create = useCreateReviewSet();
  const [size, setSize] = useState("20");
  const [language, setLanguage] = useState<Language>("en");
  const [name, setName] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const count = Math.min(100, Math.max(1, Number(size) || 20));
    create.mutate(
      { size: count, language, name: name.trim() || null },
      { onSuccess: (created) => onCreated(created.id) },
    );
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">{t("review.create.title")}</h2>
        <p className="text-muted">{t("review.create.description")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label={t("review.create.size")}
            type="number"
            min={1}
            max={100}
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
          <Select
            label={t("review.create.language")}
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
            options={[
              { value: "en", label: t("feedback.language.en") },
              { value: "bn", label: t("feedback.language.bn") },
            ]}
          />
          <Input
            label={t("review.create.name")}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" className="self-start" loading={create.isPending}>
          {t("review.create.submit")}
        </Button>
      </form>
    </Card>
  );
}

function SetRow({
  set,
  selected,
  onSelect,
}: {
  set: ReviewSetRead;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={`flex w-full flex-wrap items-center gap-3 rounded-xl border p-4 text-left ${
          selected ? "border-primary bg-primary-light" : "border-black/10 bg-surface"
        }`}
      >
        <span className="font-bold">{set.name}</span>
        <span className="text-muted">{formatDateTime(set.created_at)}</span>
        <Badge variant={set.status === "ready" ? "success" : "muted"}>
          {set.status === "ready"
            ? t("review.set.ready")
            : t("review.set.building", { done: set.ready_items, total: set.items })}
        </Badge>
        <span className="uppercase">{set.language}</span>
        <span>{t("review.set.progress", { done: set.my_ratings, total: set.items })}</span>
      </button>
    </li>
  );
}

/** The blind human evaluation: LLM reports against template reports (docs/llm-evaluation.md). */
export function AdminReportReviewPage() {
  const sets = useReviewSets();
  const [chosen, setChosen] = useState<number | null>(null);
  const [tab, setTab] = useState("rate");
  const selected = sets.data?.find((set) => set.id === chosen) ?? sets.data?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Link to="/admin/research" className={buttonClasses("ghost", "md", "-ml-3 self-start")}>
        <ArrowLeft size={20} aria-hidden />
        {t("page.admin.research.title")}
      </Link>
      <PageHeader title={t("review.title")} description={t("review.intro")} />
      <CreateSetForm onCreated={setChosen} />
      {sets.isPending && <Skeleton className="h-24 rounded-xl" />}
      {sets.isError && <QueryError onRetry={() => void sets.refetch()} />}
      {sets.data && sets.data.length === 0 && (
        <Card>
          <EmptyState icon={ClipboardCheck} title={t("review.empty")} />
        </Card>
      )}
      {sets.data && sets.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sets.data.map((set) => (
            <SetRow
              key={set.id}
              set={set}
              selected={set.id === selected?.id}
              onSelect={() => setChosen(set.id)}
            />
          ))}
        </ul>
      )}
      {selected && selected.status === "building" && (
        <Card>
          <EmptyState title={t("review.set.waiting")} description={t("review.set.waitingHint")} />
        </Card>
      )}
      {selected && selected.status === "ready" && (
        <Tabs
          label={t("review.tabsLabel")}
          tabs={[
            { id: "rate", label: t("review.tab.rate") },
            { id: "results", label: t("review.tab.results") },
          ]}
          value={tab}
          onChange={setTab}
        >
          {tab === "rate" ? (
            <RaterView key={selected.id} setId={selected.id} />
          ) : (
            <ResultsView key={selected.id} setId={selected.id} />
          )}
        </Tabs>
      )}
    </div>
  );
}
