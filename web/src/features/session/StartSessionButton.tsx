import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { GAME_IDS } from "@/games/shared/registry";
import { t } from "@/i18n";
import { SILENT } from "@/lib/apiErrors";

import { ResumeOffer } from "./ResumeOffer";
import { ACTIVE_SESSION_KEY, fetchActiveSession, useStartSession } from "./SessionContext";
import { decideResume } from "./sessionSteps";

/**
 * Start session, or, while a session from the last two hours is still open, "Continue your
 * session" and "Start over".
 */
export function StartSessionButton({
  className,
  compact = false,
}: {
  className?: string;
  /** For the page header: one button, "Continue your session", instead of the full choice. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const showToast = useToast();
  const startSession = useStartSession();
  const active = useQuery({
    queryKey: ACTIVE_SESSION_KEY,
    queryFn: fetchActiveSession,
    // A failure only means no offer to continue; Start session still resumes it.
    meta: SILENT,
    retry: 1,
  });

  if (active.isPending)
    return <Skeleton className={compact ? "h-11 w-48 rounded-lg" : "h-14 rounded-lg"} />;

  const decision = decideResume(active.data, "/patient", GAME_IDS);
  if (active.data && decision.kind === "offer" && compact) {
    return (
      <Button className={className} onClick={() => void navigate(decision.path)}>
        <Play size={20} aria-hidden />
        {t("resume.continue")}
      </Button>
    );
  }
  if (active.data && decision.kind === "offer") {
    return (
      <div className="border-accent rounded-xl border-2 p-4">
        <h3 className="text-xl font-bold">{t("resume.title")}</h3>
        <ResumeOffer
          session={active.data}
          path={decision.path}
          step={decision.step}
          onContinue={(path) => void navigate(path)}
          onStartedOver={() => void navigate("/session/setup")}
        />
      </div>
    );
  }

  return (
    <Button
      size="lg"
      className={className}
      loading={startSession.isPending}
      onClick={() =>
        startSession.mutate(undefined, {
          onSuccess: () => void navigate("/session/setup"),
          onError: () => showToast("error", t("session.startError")),
        })
      }
    >
      <Play size={22} aria-hidden />
      {t("nav.patient.startSession")}
    </Button>
  );
}
