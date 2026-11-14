import { FlaskConical, Plus } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { QueryError } from "@/components/ui/QueryError";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { ExportButton } from "@/features/admin/ExportButton";
import { usePatients } from "@/features/admin/hooks";
import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatDate } from "@/lib/format";
import type { Study } from "@/types/api";

import {
  CONDITION_LABEL_KEYS,
  conditionsText,
  draftOf,
  EMPTY_DRAFT,
  ENGINE_MODES,
  STATUS_LABEL_KEYS,
  type StudyDraft,
  toggleCondition,
  toggleGame,
  toPayload,
  useDeleteStudy,
  useEnrol,
  useSaveStudy,
  useStudies,
  useStudyProgress,
  useWithdraw,
  validateStudy,
} from "./studyModel";
import { StudyResultsView } from "./StudyResultsView";

const STATUS_TONE = { draft: "neutral", active: "success", closed: "muted" } as const;

/** Create or edit a study. The design is fixed once it is active or has participants. */
function StudyForm({
  study,
  onSaved,
  onCancel,
}: {
  study: Study | null;
  onSaved: (study: Study) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<StudyDraft>(study ? draftOf(study) : EMPTY_DRAFT);
  const save = useSaveStudy(study?.id ?? null);
  const designFixed = study !== null && (study.status !== "draft" || study.participants > 0);
  const problems = validateStudy(draft);
  const uid = useId();

  function submit() {
    const payload = toPayload(draft);
    const body = designFixed ? { name: payload.name, description: payload.description } : payload;
    save.mutate(body, { onSuccess: onSaved });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (problems.length === 0) submit();
      }}
    >
      <Input
        label={t("study.form.name")}
        value={draft.name}
        maxLength={120}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <Textarea
        label={t("study.form.description")}
        rows={2}
        maxLength={2000}
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
      />
      {designFixed && <p className="text-muted">{t("study.form.designFixed")}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t("study.form.design")}
          hint={t(
            draft.design === "within_subject"
              ? "study.design.withinHint"
              : "study.design.betweenHint",
          )}
          disabled={designFixed}
          value={draft.design}
          onChange={(event) =>
            setDraft({
              ...draft,
              design:
                event.target.value === "between_subject" ? "between_subject" : "within_subject",
            })
          }
          options={[
            { value: "within_subject", label: t("study.design.within") },
            { value: "between_subject", label: t("study.design.between") },
          ]}
        />
        <Input
          label={t("study.form.sessions")}
          hint={t("study.form.sessionsHint")}
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          disabled={designFixed}
          value={
            Number.isNaN(draft.sessions_per_condition) ? "" : String(draft.sessions_per_condition)
          }
          onChange={(event) =>
            setDraft({
              ...draft,
              sessions_per_condition:
                event.target.value === "" ? Number.NaN : Number(event.target.value),
            })
          }
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-semibold">{t("study.form.conditions")}</legend>
        {ENGINE_MODES.map((mode) => (
          <Switch
            key={mode}
            checked={draft.conditions.includes(mode)}
            disabled={designFixed}
            label={t(CONDITION_LABEL_KEYS[mode])}
            onChange={(on) => setDraft(toggleCondition(draft, mode, on))}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-semibold">{t("study.form.games")}</legend>
        <p className="text-muted text-sm" id={`${uid}-games`}>
          {t("study.form.gamesHint")}
        </p>
        <div className="grid gap-1 sm:grid-cols-2">
          {GAME_IDS.map((game) => {
            const index = draft.games.indexOf(game);
            const name = t(GAMES[game].nameKey);
            return (
              <Switch
                key={game}
                checked={index >= 0}
                disabled={designFixed}
                label={index >= 0 ? `${index + 1}. ${name}` : name}
                onChange={(on) => setDraft(toggleGame(draft, game, on))}
              />
            );
          })}
        </div>
      </fieldset>
      {problems.length > 0 && (
        <ul role="alert" className="text-danger list-disc pl-6 font-medium">
          {problems.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
      {save.isError && (
        <p role="alert" className="text-danger font-medium">
          {t("study.form.saveError")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={problems.length > 0} loading={save.isPending}>
          {t(study ? "study.form.save" : "study.form.create")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Start, close or delete, each after a confirmation. */
function StudyActions({ study, onDeleted }: { study: Study; onDeleted: () => void }) {
  const save = useSaveStudy(study.id);
  const remove = useDeleteStudy();
  const [confirm, setConfirm] = useState<"active" | "closed" | "delete" | null>(null);
  const texts: Record<
    "active" | "closed" | "delete",
    { title: TranslationKey; body: TranslationKey; button: TranslationKey }
  > = {
    active: { title: "study.start.title", body: "study.start.body", button: "study.start" },
    closed: { title: "study.close.title", body: "study.close.body", button: "study.close" },
    delete: { title: "study.delete.title", body: "study.delete.body", button: "study.delete" },
  };

  function run() {
    if (confirm === "delete") {
      remove.mutate(study.id, {
        onSuccess: () => {
          setConfirm(null);
          onDeleted();
        },
      });
    } else if (confirm) {
      save.mutate({ status: confirm }, { onSuccess: () => setConfirm(null) });
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {study.status === "draft" && (
        <Button onClick={() => setConfirm("active")}>{t("study.start")}</Button>
      )}
      {study.status !== "closed" && (
        <Button variant="secondary" onClick={() => setConfirm("closed")}>
          {t("study.close")}
        </Button>
      )}
      {study.status === "draft" && study.participants === 0 && (
        <Button variant="secondary" onClick={() => setConfirm("delete")}>
          {t("study.delete")}
        </Button>
      )}
      <Modal
        open={confirm !== null}
        title={confirm ? t(texts[confirm].title) : ""}
        onClose={() => setConfirm(null)}
      >
        {confirm && <p>{t(texts[confirm].body)}</p>}
        {(save.isError || remove.isError) && (
          <p role="alert" className="text-danger mt-3 font-medium">
            {t("study.actionError")}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={run} loading={save.isPending || remove.isPending}>
            {confirm ? t(texts[confirm].button) : ""}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** Enrol a consenting patient; the server assigns the order or condition. */
function EnrolForm({ study }: { study: Study }) {
  const patients = usePatients();
  const progress = useStudyProgress(study.id);
  const enrol = useEnrol(study.id);
  const [chosen, setChosen] = useState("");
  const enrolled = new Set(progress.data?.participants.map((p) => p.patient_id) ?? []);
  const eligible = (patients.data ?? []).filter(
    (patient) => patient.research_consent_at && !enrolled.has(patient.id) && patient.user.is_active,
  );
  if (study.status === "closed") return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <Select
            label={t("study.enrol.patient")}
            hint={t("study.enrol.hint")}
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            options={[
              { value: "", label: t("common.select") },
              ...eligible.map((patient) => ({
                value: String(patient.id),
                label: patient.patient_code,
              })),
            ]}
          />
        </div>
        <Button
          disabled={chosen === ""}
          loading={enrol.isPending}
          onClick={() => enrol.mutate(Number(chosen), { onSuccess: () => setChosen("") })}
        >
          {t("study.enrol.button")}
        </Button>
      </div>
      {enrol.isError && (
        <p role="alert" className="text-danger font-medium">
          {t("study.enrol.error")}
        </p>
      )}
    </div>
  );
}

function ProgressTable({ study }: { study: Study }) {
  const progress = useStudyProgress(study.id);
  const withdraw = useWithdraw(study.id);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  if (progress.isPending) return <Skeleton className="h-32" />;
  if (progress.isError) return <QueryError onRetry={() => void progress.refetch()} />;
  const rows = progress.data.participants;
  if (rows.length === 0) return <EmptyState title={t("study.progress.empty")} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-black/10">
            <th scope="col" className="px-3 py-2">
              {t("study.progress.code")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t(
                study.design === "within_subject"
                  ? "study.progress.order"
                  : "study.progress.condition",
              )}
            </th>
            {progress.data.conditions.map((mode) => (
              <th key={mode} scope="col" className="px-3 py-2">
                {t(CONDITION_LABEL_KEYS[mode])}
              </th>
            ))}
            <th scope="col" className="px-3 py-2">
              {t("study.progress.status")}
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">{t("study.progress.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-2 font-semibold">{row.patient_code}</td>
              <td className="px-3 py-2">{conditionsText(row)}</td>
              {progress.data.conditions.map((mode) => (
                <td key={mode} className="px-3 py-2 tabular-nums">
                  {t("study.progress.done", {
                    done: row.sessions_done[mode] ?? 0,
                    total: progress.data.sessions_per_condition,
                  })}
                </td>
              ))}
              <td className="px-3 py-2">
                {row.withdrawn_at
                  ? t("study.progress.withdrawn", { date: formatDate(row.withdrawn_at) })
                  : row.complete
                    ? t("study.progress.complete")
                    : row.next_condition
                      ? t("study.progress.next", {
                          condition: t(CONDITION_LABEL_KEYS[row.next_condition]),
                        })
                      : t("study.progress.waiting")}
              </td>
              <td className="px-3 py-2">
                {!row.withdrawn_at && study.status !== "closed" && (
                  <Button variant="secondary" onClick={() => setWithdrawing(row.id)}>
                    {t("study.withdraw")}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal
        open={withdrawing !== null}
        title={t("study.withdraw.title")}
        onClose={() => setWithdrawing(null)}
      >
        <p>{t("study.withdraw.body")}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setWithdrawing(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={withdraw.isPending}
            onClick={() =>
              withdrawing !== null &&
              withdraw.mutate(withdrawing, { onSuccess: () => setWithdrawing(null) })
            }
          >
            {t("study.withdraw")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StudyDetail({ study, onDeleted }: { study: Study; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">{study.name}</h3>
          {study.description && <p className="text-muted">{study.description}</p>}
          <p className="text-muted mt-1">
            {t("study.summary", {
              design: t(
                study.design === "within_subject" ? "study.design.within" : "study.design.between",
              ),
              conditions: study.conditions.map((mode) => t(CONDITION_LABEL_KEYS[mode])).join(", "),
              sessions: study.sessions_per_condition,
              games: study.games.map((game) => t(GAMES[game].nameKey)).join(", "),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t("study.edit")}
            </Button>
          )}
          <StudyActions study={study} onDeleted={onDeleted} />
        </div>
      </div>
      {editing && (
        <StudyForm
          study={study}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
      <section aria-labelledby={`study-${study.id}-participants`} className="flex flex-col gap-3">
        <h4 id={`study-${study.id}-participants`} className="text-lg font-semibold">
          {t("study.participants")}
        </h4>
        <EnrolForm study={study} />
        <ProgressTable study={study} />
      </section>
      <section aria-labelledby={`study-${study.id}-results`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 id={`study-${study.id}-results`} className="text-lg font-semibold">
            {t("study.results.title")}
          </h4>
          <ExportButton
            path={`/admin/studies/${study.id}/export.csv`}
            filename={`study-${study.id}.csv`}
            labelKey="study.export"
          />
        </div>
        <StudyResultsView studyId={study.id} />
      </section>
    </div>
  );
}

/** Research mode on the admin Research page: studies, enrolment, progress, results, export. */
export function StudiesSection() {
  const studies = useStudies();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const current = studies.data?.find((study) => study.id === selected) ?? null;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FlaskConical size={28} aria-hidden className="text-primary shrink-0" />
          <div>
            <h2 className="text-xl font-bold">{t("study.title")}</h2>
            <p className="text-muted">{t("study.intro")}</p>
          </div>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={20} aria-hidden />
            {t("study.new")}
          </Button>
        )}
      </div>
      {creating && (
        <StudyForm
          study={null}
          onSaved={(study) => {
            setCreating(false);
            setSelected(study.id);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {studies.isPending && <Skeleton className="h-24" />}
      {studies.isError && <QueryError onRetry={() => void studies.refetch()} />}
      {studies.isSuccess && studies.data.length === 0 && !creating && (
        <EmptyState icon={FlaskConical} title={t("study.empty")} />
      )}
      {studies.isSuccess && studies.data.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("study.listLabel")}>
          {studies.data.map((study) => (
            <li key={study.id}>
              <button
                type="button"
                aria-pressed={study.id === selected}
                onClick={() => setSelected(study.id === selected ? null : study.id)}
                className="flex min-h-11 items-center gap-2 rounded-lg border-2 border-black/10 px-3 py-2 font-medium aria-pressed:border-primary"
              >
                {study.name}
                <Badge variant={STATUS_TONE[study.status]}>
                  {t(STATUS_LABEL_KEYS[study.status])}
                </Badge>
                <span className="text-muted text-sm">
                  {t("study.participantsCount", { n: study.participants })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && (
        <StudyDetail key={current.id} study={current} onDeleted={() => setSelected(null)} />
      )}
    </Card>
  );
}
