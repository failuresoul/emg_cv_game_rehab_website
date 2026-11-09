import { type FormEvent, type ReactNode, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QueryError } from "@/components/ui/QueryError";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { parseWeeklyGoal, WEEKLY_GOAL_MAX, WEEKLY_GOAL_MIN } from "@/features/progress/progress";
import { t } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { Patient } from "@/types/api";

import { useAdminPatientProgress, useUpdatePatient } from "./hooks";

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{children}</dd>
    </div>
  );
}

function WeeklyGoalForm({ patient, onDone }: { patient: Patient; onDone: () => void }) {
  const updatePatient = useUpdatePatient(patient.id);
  const showToast = useToast();
  const [text, setText] = useState(String(patient.weekly_goal));
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const goal = parseWeeklyGoal(text);
    if (goal === null) {
      setInvalid(true);
      return;
    }
    updatePatient.mutate(
      { weekly_goal: goal },
      {
        onSuccess: () => {
          showToast("success", t("adminPractice.goalSaved", { goal }));
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
      <div className="w-40">
        <Input
          label={t("adminPractice.weeklyGoal")}
          type="number"
          inputMode="numeric"
          min={WEEKLY_GOAL_MIN}
          max={WEEKLY_GOAL_MAX}
          step={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          error={
            invalid
              ? t("adminPractice.goalInvalid", { min: WEEKLY_GOAL_MIN, max: WEEKLY_GOAL_MAX })
              : undefined
          }
          autoFocus
        />
      </div>
      <Button type="submit" loading={updatePatient.isPending}>
        {t("common.save")}
      </Button>
      <Button variant="secondary" onClick={onDone}>
        {t("common.cancel")}
      </Button>
      {updatePatient.isError && (
        <p role="alert" className="text-danger w-full font-medium">
          {t("adminPractice.goalError")}
        </p>
      )}
    </form>
  );
}

/** Weekly goal (editable), streak, sessions this week and the last session's date. */
export function PatientPracticeSummary({ patient }: { patient: Patient }) {
  const progress = useAdminPatientProgress(patient.id);
  const [editing, setEditing] = useState(false);

  return (
    <section aria-labelledby="practice-title" className="flex flex-col gap-4">
      <h2 id="practice-title" className="text-xl font-bold">
        {t("adminPractice.title")}
      </h2>
      {progress.isPending && <Skeleton className="h-24" />}
      {progress.isError && <QueryError onRetry={() => void progress.refetch()} />}
      {progress.isSuccess && (
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-muted">{t("adminPractice.weeklyGoal")}</dt>
            <dd className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold tabular-nums">
                {t("adminPractice.goalValue", { goal: patient.weekly_goal })}
              </span>
              {!editing && (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  {t("adminPractice.editGoal")}
                </Button>
              )}
            </dd>
          </div>
          <Figure label={t("adminPractice.thisWeek")}>
            {t("progress.weekly.short", {
              done: progress.data.sessions_this_week,
              goal: patient.weekly_goal,
            })}
          </Figure>
          <Figure label={t("patient.streak.title")}>
            {t(progress.data.streak_days === 1 ? "patient.streak.day" : "patient.streak.days", {
              days: progress.data.streak_days,
            })}
          </Figure>
          <Figure label={t("adminPractice.lastSession")}>
            <span className="text-lg">
              {progress.data.last_session_date
                ? formatDateTime(progress.data.last_session_date)
                : t("adminPractice.noSessions")}
            </span>
          </Figure>
        </dl>
      )}
      {editing && <WeeklyGoalForm patient={patient} onDone={() => setEditing(false)} />}
    </section>
  );
}
