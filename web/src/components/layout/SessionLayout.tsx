import clsx from "clsx";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router";

import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { QueryError } from "@/components/ui/QueryError";
import { Spinner } from "@/components/ui/Spinner";
import { useOptionalEmgEngine } from "@/emg/EmgProvider";
import { readEmgPreference } from "@/emg/preference";
import { useAuth } from "@/features/auth/AuthContext";
import { EmgStatusDot } from "@/features/emg/EmgStatusDot";
import { ResumeOffer } from "@/features/session/ResumeOffer";
import { SessionProvider, useSession } from "@/features/session/SessionContext";
import { SessionExitButton } from "@/features/session/SessionExitButton";
import {
  BAR_STEPS,
  barIndex,
  decideResume,
  type ResumeDecision,
  stepForPath,
} from "@/features/session/sessionSteps";
import { stopSession } from "@/features/session/stopSession";
import { GAME_IDS } from "@/games/shared/registry";
import { t, type TranslationKey } from "@/i18n";

/** Set as `handle` on each session route to name the step in the top bar. */
export interface SessionRouteHandle {
  stepKey: TranslationKey;
}

/** Setup • Calibrate • Warm-up • Games • Cool-down, with the current step highlighted. */
function StepBar({ pathname }: { pathname: string }) {
  const step = stepForPath(pathname);
  if (step === null) return null;
  const current = barIndex(step);

  return (
    <nav aria-label={t("sessionBar.label")} className="px-4 pb-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {BAR_STEPS.map((item, index) => {
          const done = index < current;
          const isCurrent = index === current;
          return (
            <li key={item.id} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden className="text-white/50">
                  •
                </span>
              )}
              <span
                aria-current={isCurrent ? "step" : undefined}
                className={clsx(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 font-semibold",
                  isCurrent && "bg-accent text-white",
                  done && "text-white",
                  !isCurrent && !done && "text-white/70",
                )}
              >
                {done && <Check size={18} aria-hidden />}
                {t(item.labelKey)}
                {done && <span className="sr-only">{t("sessionBar.done")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Asks once, on arriving, whether to continue a session left part way through. */
function ResumePrompt() {
  const { session, isLoading } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const decided = useRef(false);
  const [decision, setDecision] = useState<ResumeDecision>({ kind: "none" });

  useEffect(() => {
    if (decided.current || isLoading || session === null) return;
    decided.current = true;
    // Decided only on arrival: moving on through the steps afterwards never asks.
    setDecision(decideResume(session, pathname, GAME_IDS));
  }, [isLoading, session, pathname]);

  if (decision.kind !== "offer" || session === null) return null;

  return (
    <Modal open title={t("resume.title")} onClose={() => setDecision({ kind: "none" })}>
      <ResumeOffer
        session={session}
        path={decision.path}
        step={decision.step}
        onContinue={(path) => {
          setDecision({ kind: "none" });
          stopSession();
          void navigate(path, { replace: true });
        }}
        onStartedOver={() => {
          setDecision({ kind: "none" });
          void navigate("/session/setup", { replace: true });
        }}
      />
    </Modal>
  );
}

function SessionContent() {
  const { isLoading, isError, retry } = useSession();

  if (isLoading) {
    return (
      <div className="m-auto">
        <Spinner size={48} />
      </div>
    );
  }
  if (isError) {
    return (
      <Card className="m-auto max-w-xl">
        <QueryError onRetry={retry} />
      </Card>
    );
  }
  return <Outlet />;
}

/** The muscle sensor's dot, when the patient uses it today (or it is connected). */
function SensorDot() {
  const { user } = useAuth();
  return <EmgStatusDot inUse={readEmgPreference(user?.patient_profile?.id)} />;
}

export function SessionLayout() {
  const matches = useMatches();
  const { pathname } = useLocation();
  const handle = matches.at(-1)?.handle as SessionRouteHandle | undefined;

  // Leaving the session pages any other way, such as the browser's Back button, stops it all too.
  useEffect(() => () => void stopSession(), []);
  // The muscle sensor too: the serial port is closed and today's calibration forgotten, so the
  // next session starts with its own safety check and calibration.
  const emgEngine = useOptionalEmgEngine();
  useEffect(
    () => () => {
      if (!emgEngine) return;
      emgEngine.setCalibration(null);
      emgEngine.setSite(null);
      void emgEngine.disconnect().catch(() => undefined);
    },
    [emgEngine],
  );

  return (
    <SessionProvider>
      <div className="bg-session-bg flex min-h-dvh flex-col text-white">
        <header className="flex flex-col">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <p className="text-xl font-semibold">{handle && t(handle.stepKey)}</p>
            <div className="flex items-center gap-2">
              <SensorDot />
              <SessionExitButton />
            </div>
          </div>
          <StepBar pathname={pathname} />
        </header>
        <main className="flex flex-1 flex-col p-4">
          <SessionContent />
        </main>
        <ResumePrompt />
      </div>
    </SessionProvider>
  );
}
