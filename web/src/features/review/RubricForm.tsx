import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { t, type TranslationKey } from "@/i18n";
import type { ReviewDimension, ReviewRatingCreate, ReviewRater } from "@/types/api";

export const DIMENSIONS: readonly ReviewDimension[] = [
  "accuracy",
  "safety",
  "helpfulness",
  "clarity",
  "tone",
];
const SCORES = [1, 2, 3, 4, 5];
const RATER_STORE = "muvi-review-rater";

/** Each dimension's name and its anchors for 1, 3 and 5. */
export const RUBRIC: Record<
  ReviewDimension,
  { name: TranslationKey; anchors: [TranslationKey, TranslationKey, TranslationKey] }
> = {
  accuracy: {
    name: "review.rubric.accuracy",
    anchors: ["review.rubric.accuracy.1", "review.rubric.accuracy.3", "review.rubric.accuracy.5"],
  },
  safety: {
    name: "review.rubric.safety",
    anchors: ["review.rubric.safety.1", "review.rubric.safety.3", "review.rubric.safety.5"],
  },
  helpfulness: {
    name: "review.rubric.helpfulness",
    anchors: [
      "review.rubric.helpfulness.1",
      "review.rubric.helpfulness.3",
      "review.rubric.helpfulness.5",
    ],
  },
  clarity: {
    name: "review.rubric.clarity",
    anchors: ["review.rubric.clarity.1", "review.rubric.clarity.3", "review.rubric.clarity.5"],
  },
  tone: {
    name: "review.rubric.tone",
    anchors: ["review.rubric.tone.1", "review.rubric.tone.3", "review.rubric.tone.5"],
  },
};

function savedRater(): ReviewRater {
  try {
    return localStorage.getItem(RATER_STORE) === "clinician" ? "clinician" : "team";
  } catch {
    return "team";
  }
}

/** The rubric: 1-5 on each dimension with short anchors, "unsafe", any unsupported sentence. */
export function RubricForm({
  code,
  pending,
  error,
  onSubmit,
}: {
  code: string;
  pending: boolean;
  error: string | null;
  onSubmit: (rating: ReviewRatingCreate) => void;
}) {
  const [rater, setRater] = useState<ReviewRater>(savedRater);
  const [scores, setScores] = useState<Partial<Record<ReviewDimension, number>>>({});
  const [unsafe, setUnsafe] = useState<boolean | null>(null);
  const [unsupported, setUnsupported] = useState("");
  const [comment, setComment] = useState("");
  const [missing, setMissing] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const complete = DIMENSIONS.every((dimension) => scores[dimension] !== undefined);
    if (!complete || unsafe === null) {
      setMissing(true);
      return;
    }
    try {
      localStorage.setItem(RATER_STORE, rater);
    } catch {
      // Only a convenience.
    }
    onSubmit({
      rater,
      scores: scores as Record<ReviewDimension, number>,
      unsafe,
      unsupported: unsupported.trim() || null,
      comment: comment.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Select
        label={t("review.rater")}
        value={rater}
        onChange={(event) => setRater(event.target.value as ReviewRater)}
        options={[
          { value: "team", label: t("feedback.admin.rater.team") },
          { value: "clinician", label: t("feedback.admin.rater.clinician") },
        ]}
      />
      {DIMENSIONS.map((dimension) => {
        const { name, anchors } = RUBRIC[dimension];
        return (
          <fieldset key={dimension} className="flex flex-col gap-2">
            <legend className="font-bold">{t(name)}</legend>
            <ul className="text-muted text-sm">
              {anchors.map((anchor, index) => (
                <li key={anchor}>
                  <span className="font-semibold">{[1, 3, 5][index]}</span> {t(anchor)}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              {SCORES.map((score) => (
                <label
                  key={score}
                  className="has-checked:bg-primary has-checked:text-white has-focus-visible:outline-primary has-focus-visible:outline-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-black/20 font-semibold"
                >
                  <input
                    type="radio"
                    name={`${code}-${dimension}`}
                    value={score}
                    checked={scores[dimension] === score}
                    onChange={() => setScores((current) => ({ ...current, [dimension]: score }))}
                    className="sr-only"
                  />
                  {score}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">{t("review.unsafe")}</legend>
        <p className="text-muted text-sm">{t("review.unsafeHint")}</p>
        <div className="flex gap-4">
          {[false, true].map((answer) => (
            <label key={String(answer)} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${code}-unsafe`}
                checked={unsafe === answer}
                onChange={() => setUnsafe(answer)}
              />
              {answer ? t("feedback.admin.yes") : t("feedback.admin.no")}
            </label>
          ))}
        </div>
      </fieldset>
      <Textarea
        label={t("review.unsupported")}
        value={unsupported}
        maxLength={1000}
        onChange={(event) => setUnsupported(event.target.value)}
      />
      <Textarea
        label={t("review.comment")}
        value={comment}
        maxLength={300}
        onChange={(event) => setComment(event.target.value)}
      />
      {missing && <p className="text-danger">{t("review.missing")}</p>}
      {error && <p className="text-danger">{error}</p>}
      <Button type="submit" className="self-start" loading={pending}>
        {t("review.submit")}
      </Button>
    </form>
  );
}
