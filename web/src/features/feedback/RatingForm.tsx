import axios from "axios";
import clsx from "clsx";
import { Star } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { t } from "@/i18n";

import { useRateReport } from "./hooks";

const STARS = [1, 2, 3, 4, 5];
const COMMENT_MAX = 300;

/** "Was this helpful?": 1-5 stars and an optional comment, sent as the participant's rating
 * (usefulness). The comment is stored for the team and never sent to the model. */
export function RatingForm({ jobId }: { jobId: number }) {
  const rate = useRateReport(jobId);
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [missing, setMissing] = useState(false);
  const alreadyRated =
    rate.isError && axios.isAxiosError(rate.error) && rate.error.response?.status === 409;

  if (rate.isSuccess || alreadyRated) {
    return (
      <p role="status" className="text-success font-semibold">
        {t("feedback.rating.thanks")}
      </p>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (stars === null) {
      setMissing(true);
      return;
    }
    const text = comment.trim();
    rate.mutate({ rater: "participant", scores: { usefulness: stars }, comment: text || null });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 print:hidden">
      <fieldset>
        <legend className="mb-2 font-semibold">{t("feedback.rating.question")}</legend>
        <div className="flex gap-1">
          {STARS.map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name={`rating-${jobId}`}
                value={value}
                checked={stars === value}
                onChange={() => {
                  setStars(value);
                  setMissing(false);
                }}
                className="peer sr-only"
              />
              <span className="sr-only">{t("feedback.rating.star", { count: value })}</span>
              <Star
                size={36}
                aria-hidden
                className={clsx(
                  "peer-focus-visible:outline-primary rounded peer-focus-visible:outline-2",
                  stars !== null && value <= stars ? "fill-accent text-accent" : "text-muted",
                )}
              />
            </label>
          ))}
        </div>
        {missing && <p className="text-danger mt-1">{t("feedback.rating.choose")}</p>}
      </fieldset>
      <Textarea
        label={t("feedback.rating.comment")}
        value={comment}
        maxLength={COMMENT_MAX}
        onChange={(event) => setComment(event.target.value)}
      />
      {rate.isError && !alreadyRated && <p className="text-danger">{t("feedback.rating.error")}</p>}
      <Button type="submit" className="self-start" loading={rate.isPending}>
        {t("feedback.rating.send")}
      </Button>
    </form>
  );
}
