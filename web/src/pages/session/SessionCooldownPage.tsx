import { Annoyed, Frown, Laugh, type LucideIcon, Meh, Smile, Star } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { type Choice, ChoiceGroup } from "@/features/session/ChoiceGroup";
import {
  COMMENT_MAX,
  DIFFICULTIES,
  DIFFICULTY_LABEL_KEYS,
  EMPTY_DRAFT,
  type FaceLevel,
  painFace,
  type QuestionnaireDraft,
  RELAX_SECONDS,
  SCALE_0_10,
  STARS_1_5,
  toPayload,
  unanswered,
} from "@/features/session/questionnaire";
import { useEndSession, useSession } from "@/features/session/SessionContext";
import { useSubmitQuestionnaire } from "@/features/session/useQuestionnaire";
import { t } from "@/i18n";
import type { Difficulty } from "@/types/api";

const FACES: Record<FaceLevel, LucideIcon> = {
  laugh: Laugh,
  smile: Smile,
  meh: Meh,
  frown: Frown,
  annoyed: Annoyed,
};

/** A minute of rest with a slowly breathing circle, which keeps still for reduced motion. */
function RelaxStep({ onDone }: { onDone: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(RELAX_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, onDone]);

  return (
    <Card className="m-auto flex w-full max-w-xl flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-bold">{t("cooldown.relax.title")}</h1>
      <div className="flex size-56 items-center justify-center" aria-hidden>
        <div className="bg-primary/30 border-primary motion-safe:animate-breathe size-56 rounded-full border-4" />
      </div>
      <p className="text-xl font-semibold">{t("cooldown.relax.armRest")}</p>
      <p className="text-lg">{t("cooldown.relax.breathe")}</p>
      <p aria-live="off" className="text-muted text-xl tabular-nums">
        {t("cooldown.relax.seconds", { seconds: secondsLeft })}
      </p>
      <Button size="lg" variant="secondary" onClick={onDone}>
        {t("cooldown.relax.skip")}
      </Button>
    </Card>
  );
}

function ScaleHint({ low, high }: { low: string; high: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 text-lg">
      <span>{low}</span>
      <span>{high}</span>
    </div>
  );
}

const SCALE_GRID = "grid-cols-6 sm:grid-cols-11";

function painChoices(): Choice<number>[] {
  return SCALE_0_10.map((value) => {
    const Face = FACES[painFace(value)];
    return {
      value,
      label: t("cooldown.scaleValue", { value }),
      content: (
        <>
          <Face size={28} aria-hidden />
          <span className="tabular-nums">{value}</span>
        </>
      ),
    };
  });
}

function fatigueChoices(): Choice<number>[] {
  return SCALE_0_10.map((value) => ({
    value,
    label: t("cooldown.scaleValue", { value }),
    content: <span className="text-xl tabular-nums">{value}</span>,
  }));
}

function starChoices(selected: number | null): Choice<number>[] {
  return STARS_1_5.map((value) => ({
    value,
    label: t("cooldown.enjoyment.stars", { count: value }),
    content: (
      <Star
        size={36}
        aria-hidden
        className={selected !== null && value <= selected ? "fill-accent text-accent" : ""}
      />
    ),
  }));
}

function difficultyChoices(): Choice<Difficulty>[] {
  return DIFFICULTIES.map((value) => ({ value, label: t(DIFFICULTY_LABEL_KEYS[value]) }));
}

function yesNoChoices(): Choice<boolean>[] {
  return [
    { value: true, label: t("cooldown.yes") },
    { value: false, label: t("cooldown.no") },
  ];
}

function Questionnaire() {
  const navigate = useNavigate();
  const { sessionId } = useSession();
  const submitQuestionnaire = useSubmitQuestionnaire();
  const endSession = useEndSession();
  const [draft, setDraft] = useState<QuestionnaireDraft>(EMPTY_DRAFT);
  const [showRequired, setShowRequired] = useState(false);

  function update(changes: Partial<QuestionnaireDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function finish() {
    if (sessionId === null) {
      void navigate("/session/summary");
      return;
    }
    endSession.mutate(
      { sessionId, status: "completed" },
      { onSuccess: () => void navigate("/session/summary") },
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const answers = toPayload(draft);
    if (answers === null) {
      setShowRequired(true);
      return;
    }
    if (sessionId === null) {
      finish();
      return;
    }
    submitQuestionnaire.mutate({ sessionId, answers }, { onSuccess: finish });
  }

  const missing = showRequired && unanswered(draft).length > 0;
  const isPending = submitQuestionnaire.isPending || endSession.isPending;

  return (
    <Card className="m-auto w-full max-w-4xl">
      <form noValidate onSubmit={submit} className="flex flex-col gap-10">
        <div>
          <h1 className="text-2xl font-bold">{t("cooldown.form.title")}</h1>
          <p className="mt-2 text-lg">{t("cooldown.form.intro")}</p>
        </div>
        <ChoiceGroup
          legend={t("cooldown.pain.legend")}
          choices={painChoices()}
          value={draft.pain}
          onChange={(pain) => update({ pain })}
          hint={<ScaleHint low={t("cooldown.pain.low")} high={t("cooldown.pain.high")} />}
          showRequired={showRequired}
          className={SCALE_GRID}
          choiceClassName="min-h-20"
        />
        <ChoiceGroup
          legend={t("cooldown.fatigue.legend")}
          choices={fatigueChoices()}
          value={draft.fatigue}
          onChange={(fatigue) => update({ fatigue })}
          hint={<ScaleHint low={t("cooldown.fatigue.low")} high={t("cooldown.fatigue.high")} />}
          showRequired={showRequired}
          className={SCALE_GRID}
        />
        <ChoiceGroup
          legend={t("cooldown.enjoyment.legend")}
          choices={starChoices(draft.enjoyment)}
          value={draft.enjoyment}
          onChange={(enjoyment) => update({ enjoyment })}
          showRequired={showRequired}
          className="max-w-md grid-cols-5"
          choiceClassName="min-h-20"
        />
        <ChoiceGroup
          legend={t("cooldown.difficulty.legend")}
          choices={difficultyChoices()}
          value={draft.difficulty}
          onChange={(difficulty) => update({ difficulty })}
          showRequired={showRequired}
          className="sm:grid-cols-3"
          choiceClassName="min-h-20 text-xl"
        />
        <ChoiceGroup
          legend={t("cooldown.newSymptoms.legend")}
          choices={yesNoChoices()}
          value={draft.newSymptoms}
          onChange={(newSymptoms) => update({ newSymptoms })}
          showRequired={showRequired}
          className="max-w-md grid-cols-2"
          choiceClassName="min-h-20 text-xl"
        />
        <div className="flex flex-col gap-1">
          <Textarea
            label={t("cooldown.comment.label")}
            value={draft.comment}
            maxLength={COMMENT_MAX}
            onChange={(event) => update({ comment: event.target.value })}
            className="text-lg"
          />
          <p className="text-muted text-right tabular-nums" aria-live="off">
            {t("cooldown.comment.count", { count: draft.comment.length, max: COMMENT_MAX })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {missing && (
            <p role="alert" className="text-danger font-medium">
              {t("cooldown.missing")}
            </p>
          )}
          {submitQuestionnaire.isError && (
            <p role="alert" className="text-danger font-medium">
              {t("cooldown.submitError")}
            </p>
          )}
          {endSession.isError && (
            <p role="alert" className="text-danger font-medium">
              {t("cooldown.error")}
            </p>
          )}
          <Button type="submit" size="lg" loading={isPending}>
            {t("cooldown.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** A minute of guided rest, then a short questionnaire about how the session felt. */
export function SessionCooldownPage() {
  const [relaxing, setRelaxing] = useState(true);
  return relaxing ? <RelaxStep onDone={() => setRelaxing(false)} /> : <Questionnaire />;
}
