import { Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { t, type TranslationKey } from "@/i18n";
import { formatRelativeTime } from "@/lib/format";
import type { SessionRecord, SessionStep } from "@/types/api";

import { useStartOver } from "./SessionContext";
import { stopSession } from "./stopSession";

const STEP_NAMES: Record<SessionStep, TranslationKey> = {
  setup: "sessionBar.setup",
  calibrate: "sessionBar.calibrate",
  warmup: "sessionBar.warmup",
  plan: "sessionBar.games",
  game: "sessionBar.games",
  cooldown: "sessionBar.cooldown",
  summary: "page.session.summary.title",
};

interface ResumeOfferProps {
  session: SessionRecord;
  /** The page the saved step resumes at. */
  path: string;
  step: SessionStep;
  onContinue: (path: string) => void;
  /** After the old session was ended and a new one started. */
  onStartedOver: () => void;
  className?: string;
}

/** "Continue your session" or "Start over", for a session left part way through. */
export function ResumeOffer({
  session,
  path,
  step,
  onContinue,
  onStartedOver,
  className,
}: ResumeOfferProps) {
  const startOver = useStartOver();

  return (
    <div className={className}>
      <p className="text-lg">
        {t("resume.body", {
          time: formatRelativeTime(session.started_at),
          step: t(STEP_NAMES[step]),
        })}
      </p>
      {startOver.isError && (
        <p role="alert" className="text-danger mt-3 font-medium">
          {t("resume.startOverError")}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button size="lg" onClick={() => onContinue(path)} disabled={startOver.isPending}>
          <Play size={22} aria-hidden />
          {t("resume.continue")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          loading={startOver.isPending}
          onClick={() => {
            // Whatever the old session's page started stops before the new one begins.
            stopSession();
            startOver.mutate(session.id, { onSuccess: onStartedOver });
          }}
        >
          <RotateCcw size={22} aria-hidden />
          {t("resume.startOver")}
        </Button>
      </div>
    </div>
  );
}
