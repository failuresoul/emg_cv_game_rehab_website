import { Camera, CircleAlert, CircleCheck, CircleX, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { t, type TranslationKey } from "@/i18n";
import { evaluateSetupChecks, type SetupChecks } from "@/vision/setupChecks";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import { useVision } from "@/vision/useVision";
import type { VisionErrorCode } from "@/vision/visionEngine";

const REQUIRED_GREEN_MS = 2000;

const ERROR_MESSAGES: Record<VisionErrorCode, TranslationKey> = {
  permissionDenied: "setup.error.permissionDenied",
  noCamera: "setup.error.noCamera",
  cameraInUse: "setup.error.cameraInUse",
  cameraLost: "setup.error.cameraLost",
  unsupported: "setup.error.unsupported",
  modelsFailed: "setup.error.modelsFailed",
  detectionFailed: "setup.error.detectionFailed",
  unknown: "setup.error.unknown",
};

const CHECK_LABELS: { key: keyof SetupChecks; labelKey: TranslationKey }[] = [
  { key: "cameraOn", labelKey: "setup.check.cameraOn" },
  { key: "handVisible", labelKey: "setup.check.handVisible" },
  { key: "shouldersVisible", labelKey: "setup.check.shouldersVisible" },
  { key: "goodDistance", labelKey: "setup.check.goodDistance" },
  { key: "enoughLight", labelKey: "setup.check.enoughLight" },
];

function Intro({ onAllow }: { onAllow: () => void }) {
  return (
    <Card className="m-auto flex max-w-xl flex-col items-center gap-4 text-center">
      <Camera size={48} aria-hidden className="text-primary" />
      <h1 className="text-2xl font-bold">{t("setup.intro.title")}</h1>
      <p>{t("setup.intro.description")}</p>
      <p className="text-primary flex items-center gap-2 font-medium">
        <ShieldCheck size={24} aria-hidden className="shrink-0" />
        {t("landing.privacy")}
      </p>
      <Button size="lg" onClick={onAllow}>
        {t("setup.intro.allow")}
      </Button>
    </Card>
  );
}

function Checklist({ checks }: { checks: SetupChecks }) {
  return (
    <ul className="flex flex-col gap-3">
      {CHECK_LABELS.map(({ key, labelKey }) => (
        <li key={key} className="flex items-center gap-3 font-medium">
          {checks[key] ? (
            <CircleCheck
              size={28}
              aria-label={t("setup.check.passed")}
              className="text-success shrink-0"
            />
          ) : (
            <CircleX
              size={28}
              aria-label={t("setup.check.notPassed")}
              className="text-danger shrink-0"
            />
          )}
          {t(labelKey)}
        </li>
      ))}
    </ul>
  );
}

function LiveCheck() {
  const navigate = useNavigate();
  const { status, result, retry } = useVision();
  const [passed, setPassed] = useState(false);

  const checks = evaluateSetupChecks(result);
  const allGreen = Object.values(checks).every(Boolean);

  // Once passed it stays passed: reaching for the mouse takes the hand out of view.
  useEffect(() => {
    if (!allGreen) return;
    const timer = setTimeout(() => setPassed(true), REQUIRED_GREEN_MS);
    return () => clearTimeout(timer);
  }, [allGreen]);

  if (status.phase === "error") {
    return (
      <Card className="m-auto max-w-xl">
        <EmptyState
          icon={CircleAlert}
          title={t("setup.error.title")}
          description={t(ERROR_MESSAGES[status.error])}
          action={
            <Button size="lg" onClick={retry}>
              {t("common.retry")}
            </Button>
          }
        />
      </Card>
    );
  }

  if (status.phase !== "running") {
    return (
      <Card role="status" className="m-auto flex max-w-xl flex-col items-center gap-4 text-center">
        <span className="text-primary">
          <Spinner size={48} />
        </span>
        <p className="text-lg font-medium">
          {t(status.phase === "loading" ? "setup.loadingModels" : "setup.waitingForCamera")}
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-4 lg:grid-cols-3">
      <div className="relative lg:col-span-2">
        <SkeletonCanvas result={result} />
        <p className="absolute top-2 right-3 rounded bg-black/60 px-2 text-white">
          {t("setup.performance", {
            fps: Math.round(result?.fps ?? 0),
            delegate: result?.delegate ?? "",
          })}
        </p>
      </div>
      <Card className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">{t("setup.checklist.title")}</h1>
        <Checklist checks={checks} />
        <Button size="lg" disabled={!passed} onClick={() => void navigate("/session/warmup")}>
          {t("setup.continue")}
        </Button>
        {!passed && <p className="text-muted">{t("setup.checklist.hint")}</p>}
      </Card>
    </div>
  );
}

export function SessionSetupPage() {
  const [allowed, setAllowed] = useState(false);

  // LiveCheck starts the camera when it mounts, so nothing runs before the patient agrees.
  return allowed ? <LiveCheck /> : <Intro onAllow={() => setAllowed(true)} />;
}
