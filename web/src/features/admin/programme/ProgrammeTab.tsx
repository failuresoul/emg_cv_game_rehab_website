import { History } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { QueryError } from "@/components/ui/QueryError";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { EmgSite, EngineMode, Programme, ProgrammeChange, ProgrammeFields } from "@/types/api";
import { EXERCISE_ORDER, EXERCISES } from "@/warmup/exercises";

import { useAdminProgramme, useProgrammeHistory, useSaveProgramme } from "../hooks";
import {
  changedFields,
  ENGINE_LABEL_KEYS,
  fieldLabel,
  fieldsOf,
  formatProgrammeValue,
  LIMITS,
  levelMeaningKey,
  levelOf,
  toUpdate,
  validateProgramme,
  withExercise,
  withGame,
  withLevel,
} from "./programmeForm";

const ENGINE_MODES: { mode: EngineMode; descriptionKey: TranslationKey }[] = [
  { mode: "L0", descriptionKey: "adminEngine.describe.L0" },
  { mode: "L1", descriptionKey: "adminEngine.describe.L1" },
  { mode: "L2", descriptionKey: "adminEngine.describe.L2" },
];

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 border-t border-black/10 pt-6 first:border-t-0 first:pt-0"
    >
      <h2 id={id} className="text-xl font-bold">
        {title}
      </h2>
      {intro && <p className="text-muted">{intro}</p>}
      {children}
    </section>
  );
}

/** A whole number from an input, or NaN while it is empty or not a number. */
const whole = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
const shown = (value: number) => (Number.isNaN(value) ? "" : String(value));

/** The admin patient page's Programme tab: what the AI, planner and warm-up must obey. */
export function ProgrammeTab({ patientId }: { patientId: number }) {
  const programme = useAdminProgramme(patientId);
  if (programme.isPending) return <Skeleton className="h-96" />;
  if (programme.isError) return <QueryError onRetry={() => void programme.refetch()} />;
  return (
    <div className="flex flex-col gap-10">
      {/* A saved programme starts the form again from what was saved. */}
      <ProgrammeEditor
        key={programme.data.updated_at}
        programme={programme.data}
        patientId={patientId}
      />
      <ProgrammeHistory patientId={patientId} />
    </div>
  );
}

function ProgrammeEditor({ programme, patientId }: { programme: Programme; patientId: number }) {
  const saved = useMemo(() => fieldsOf(programme), [programme]);
  const [draft, setDraft] = useState<ProgrammeFields>(saved);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const save = useSaveProgramme(patientId);
  const changes = changedFields(saved, draft);
  const problems = validateProgramme(draft, programme.library_disabled_games);
  const libraryOff = new Set(programme.library_disabled_games);
  const uid = useId();

  function confirm() {
    save.mutate(toUpdate(draft, reason), {
      onSuccess: () => {
        setConfirmOpen(false);
        setReason("");
      },
    });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (changes.length > 0 && problems.length === 0) setConfirmOpen(true);
      }}
    >
      <p className="text-muted">{t("programme.intro")}</p>

      <Section
        id={`${uid}-games`}
        title={t("programme.section.games")}
        intro={t("programme.games.intro")}
      >
        <ul className="flex flex-col divide-y divide-black/10">
          {GAME_IDS.map((game) => {
            const off = libraryOff.has(game);
            const on = draft.enabled_games.includes(game) && !off;
            const level = levelOf(draft, game);
            const name = t(GAMES[game].nameKey);
            return (
              <li
                key={game}
                className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-6"
              >
                <div className="lg:w-64">
                  <Switch
                    checked={on}
                    disabled={off}
                    label={name}
                    onChange={(value) => setDraft(withGame(draft, game, value))}
                  />
                  {off && <p className="text-muted text-sm">{t("programme.games.libraryOff")}</p>}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <label className="flex items-center gap-3" htmlFor={`${uid}-level-${game}`}>
                    <span className="w-24 font-medium tabular-nums">
                      {t("programme.games.level", { n: level })}
                    </span>
                    <input
                      id={`${uid}-level-${game}`}
                      type="range"
                      min={LIMITS.level.min}
                      max={LIMITS.level.max}
                      step={1}
                      value={level}
                      disabled={!on}
                      aria-label={t("programme.games.levelFor", { game: name })}
                      aria-valuetext={t("programme.games.level", { n: level })}
                      onChange={(event) =>
                        setDraft(withLevel(draft, game, Number(event.target.value)))
                      }
                      className="accent-primary h-11 flex-1"
                    />
                  </label>
                  <p className="text-muted text-sm">{t(levelMeaningKey(level))}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        id={`${uid}-session`}
        title={t("programme.section.session")}
        intro={t("programme.session.intro")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t("programme.session.minutes")}
            hint={t("programme.session.minutesHint", LIMITS.minutes)}
            type="number"
            inputMode="numeric"
            min={LIMITS.minutes.min}
            max={LIMITS.minutes.max}
            value={shown(draft.session_minutes_target)}
            onChange={(event) =>
              setDraft({ ...draft, session_minutes_target: whole(event.target.value) })
            }
          />
          <Input
            label={t("programme.session.rest")}
            hint={t("programme.session.restHint", LIMITS.rest)}
            type="number"
            inputMode="numeric"
            min={LIMITS.rest.min}
            max={LIMITS.rest.max}
            value={shown(draft.rest_every_minutes)}
            onChange={(event) =>
              setDraft({ ...draft, rest_every_minutes: whole(event.target.value) })
            }
          />
          <Input
            label={t("programme.session.gamesMin")}
            hint={t("programme.session.gamesMinHint")}
            type="number"
            inputMode="numeric"
            min={LIMITS.games.min}
            max={LIMITS.games.max}
            value={shown(draft.games_per_session.min)}
            onChange={(event) =>
              setDraft({
                ...draft,
                games_per_session: { ...draft.games_per_session, min: whole(event.target.value) },
              })
            }
          />
          <Input
            label={t("programme.session.gamesMax")}
            hint={t("programme.session.gamesMaxHint")}
            type="number"
            inputMode="numeric"
            min={LIMITS.games.min}
            max={LIMITS.games.max}
            value={shown(draft.games_per_session.max)}
            onChange={(event) =>
              setDraft({
                ...draft,
                games_per_session: { ...draft.games_per_session, max: whole(event.target.value) },
              })
            }
          />
        </div>
      </Section>

      <Section
        id={`${uid}-warmup`}
        title={t("programme.section.warmup")}
        intro={t("programme.warmup.intro")}
      >
        <ul className="grid gap-1 sm:grid-cols-2">
          {EXERCISE_ORDER.map((exercise) => (
            <li key={exercise}>
              <Switch
                checked={draft.warmup_exercises.includes(exercise)}
                label={t(EXERCISES[exercise].nameKey)}
                onChange={(value) => setDraft(withExercise(draft, exercise, value))}
              />
            </li>
          ))}
        </ul>
        <div className="max-w-md">
          <Select
            label={t("programme.warmup.preset")}
            hint={t(
              draft.warmup_preset === "gentle"
                ? "programme.preset.gentleHint"
                : "programme.preset.personalHint",
            )}
            value={draft.warmup_preset}
            onChange={(event) =>
              setDraft({
                ...draft,
                warmup_preset: event.target.value === "gentle" ? "gentle" : "personal",
              })
            }
            options={[
              { value: "personal", label: t("programme.preset.personal") },
              { value: "gentle", label: t("programme.preset.gentle") },
            ]}
          />
        </div>
      </Section>

      <Section id={`${uid}-ai`} title={t("programme.section.ai")} intro={t("programme.ai.intro")}>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t("programme.field.engine_mode")}</legend>
          {ENGINE_MODES.map(({ mode, descriptionKey }) => (
            <label
              key={mode}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-1 hover:bg-black/5"
            >
              <input
                type="radio"
                name={`${uid}-engine`}
                value={mode}
                checked={draft.engine_mode === mode}
                onChange={() => setDraft({ ...draft, engine_mode: mode })}
                className="accent-primary mt-1 size-5"
              />
              <span>
                <span className="block font-semibold">
                  {t(ENGINE_LABEL_KEYS[mode])}
                  {mode === saved.engine_mode && (
                    <span className="text-muted ml-2 font-normal">{t("adminEngine.current")}</span>
                  )}
                </span>
                <span className="text-muted block">{t(descriptionKey)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-muted text-sm">{t("programme.ai.note")}</p>
      </Section>

      <Section
        id={`${uid}-sensor`}
        title={t("programme.section.sensor")}
        intro={t("programme.sensor.intro")}
      >
        <div className="max-w-md">
          <Select
            label={t("programme.field.emg_default_site")}
            value={draft.emg_default_site ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                emg_default_site:
                  event.target.value === "" ? null : (event.target.value as EmgSite),
              })
            }
            options={[
              { value: "", label: t("programme.site.none") },
              { value: "flexors", label: t("programme.site.flexors") },
              { value: "extensors", label: t("programme.site.extensors") },
            ]}
          />
        </div>
      </Section>

      <Section id={`${uid}-goals`} title={t("programme.section.goals")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t("programme.field.weekly_goal")}
            hint={t("programme.goals.weeklyHint", LIMITS.weeklyGoal)}
            type="number"
            inputMode="numeric"
            min={LIMITS.weeklyGoal.min}
            max={LIMITS.weeklyGoal.max}
            value={shown(draft.weekly_goal)}
            onChange={(event) => setDraft({ ...draft, weekly_goal: whole(event.target.value) })}
          />
        </div>
        <Textarea
          label={t("programme.field.notes")}
          maxLength={LIMITS.notes}
          rows={3}
          value={draft.notes ?? ""}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
        <p className="text-muted text-sm">{t("programme.goals.notesHint")}</p>
      </Section>

      {problems.length > 0 && (
        <ul role="alert" className="text-danger flex list-disc flex-col gap-1 pl-6 font-medium">
          {problems.map((problem) => (
            <li key={`${problem.field}-${problem.key}`}>{t(problem.key, problem.params)}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={changes.length === 0 || problems.length > 0}>
          {t("programme.save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={changes.length === 0}
          onClick={() => setDraft(saved)}
        >
          {t("programme.undo")}
        </Button>
        <p role="status" className="text-muted">
          {changes.length === 0
            ? t("programme.noChanges")
            : t("programme.changesCount", { n: changes.length })}
        </p>
      </div>

      <Modal
        open={confirmOpen}
        title={t("programme.confirmTitle")}
        onClose={() => setConfirmOpen(false)}
      >
        <p className="mb-3">{t("programme.confirmIntro")}</p>
        <ul className="flex flex-col gap-2">
          {changes.map((field) => (
            <li key={field}>
              <span className="font-semibold">{fieldLabel(field)}: </span>
              {t("programme.change", {
                before: formatProgrammeValue(field, saved[field]),
                after: formatProgrammeValue(
                  field,
                  field === "notes" ? draft.notes?.trim() : draft[field],
                ),
              })}
            </li>
          ))}
        </ul>
        {changes.includes("engine_mode") && (
          <p className="border-warning mt-4 rounded-lg border-l-4 bg-black/5 p-3">
            {t("programme.ai.confirm")}
          </p>
        )}
        <div className="mt-4">
          <Textarea
            label={t("programme.reason")}
            maxLength={LIMITS.reason}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {save.isError && (
          <p role="alert" className="text-danger mt-3 font-medium">
            {t("programme.saveError")}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={confirm} loading={save.isPending}>
            {t("programme.confirm")}
          </Button>
        </div>
      </Modal>
    </form>
  );
}

function HistoryRow({ change }: { change: ProgrammeChange }) {
  return (
    <li className="flex flex-col gap-1 py-3">
      <p className="text-muted text-sm">
        {t("programme.history.when", {
          date: formatDateTime(change.created_at),
          admin: change.admin_name ?? t("programme.history.unknownAdmin"),
        })}
      </p>
      <p>
        <span className="font-semibold">{fieldLabel(change.field)}: </span>
        {t("programme.change", {
          before: formatProgrammeValue(change.field, change.before),
          after: formatProgrammeValue(change.field, change.after),
        })}
      </p>
      {change.reason && (
        <p className="text-muted">{t("programme.history.reason", { reason: change.reason })}</p>
      )}
    </li>
  );
}

/** Every change of the programme, newest first. */
export function ProgrammeHistory({ patientId }: { patientId: number }) {
  const history = useProgrammeHistory(patientId);
  return (
    <section aria-labelledby="programme-history" className="flex flex-col gap-3">
      <h2 id="programme-history" className="text-xl font-bold">
        {t("programme.history.title")}
      </h2>
      {history.isPending && <Skeleton className="h-24" />}
      {history.isError && <QueryError onRetry={() => void history.refetch()} />}
      {history.isSuccess &&
        (history.data.length === 0 ? (
          <EmptyState icon={History} title={t("programme.history.empty")} />
        ) : (
          <ul className="flex flex-col divide-y divide-black/10">
            {history.data.map((change) => (
              <HistoryRow key={change.id} change={change} />
            ))}
          </ul>
        ))}
    </section>
  );
}
