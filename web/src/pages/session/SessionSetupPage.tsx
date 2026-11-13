import { Camera, CircleCheck, CircleX, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { readEmgPreference, writeEmgPreference } from "@/emg/preference";
import { useAuth } from "@/features/auth/AuthContext";
import { useSessionStep } from "@/features/session/SessionContext";
import { t, type TranslationKey } from "@/i18n";
import type { Side } from "@/types/api";
import { evaluateSetupChecks, type SetupChecks } from "@/vision/setupChecks";
import { SkeletonCanvas } from "@/vision/SkeletonCanvas";
import type { TrackingState } from "@/vision/tracking";
import { useTracking } from "@/vision/useTracking";
import { VisionStatusCard } from "@/vision/VisionStatusCard";

const REQUIRED_GREEN_MS = 2000;

const CHECK_LABELS: { key: keyof SetupChecks; labelKey: TranslationKey }[] = [
  { key: "cameraOn", labelKey: "setup.check.cameraOn" },
  { key: "upperBodyVisible", labelKey: "setup.check.upperBody" },
  { key: "armVisible", labelKey: "setup.check.arm" },
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

function armLabelKey(side: Side | null): TranslationKey {
  if (side === "left") return "setup.check.arm.left";
  if (side === "right") return "setup.check.arm.right";
  return "setup.check.arm";
}

function Checklist({ checks, side }: { checks: SetupChecks; side: Side | null }) {
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
          {t(key === "armVisible" ? armLabelKey(side) : labelKey)}
        </li>
      ))}
    </ul>
  );
}

function TrackingInfo({ tracking }: { tracking: TrackingState | null }) {
  const notAvailable = t("setup.debug.notAvailable");
  const wrist = tracking?.wristRawSw;
  const rows: { labelKey: TranslationKey; value: string }[] = [
    {
      labelKey: "setup.debug.shoulderWidth",
      value: tracking?.shoulderWidthPx?.toFixed(1) ?? notAvailable,
    },
    { labelKey: "setup.debug.wristX", value: wrist?.x.toFixed(2) ?? notAvailable },
    { labelKey: "setup.debug.wristY", value: wrist?.y.toFixed(2) ?? notAvailable },
  ];

  return (
    <dl className="flex flex-col gap-1">
      {rows.map(({ labelKey, value }) => (
        <div key={labelKey} className="flex justify-between gap-4">
          <dt className="text-muted">{t(labelKey)}</dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveCheck() {
  const navigate = useNavigate();
  const { status, result, retry, tracking } = useTracking();
  const [passed, setPassed] = useState(false);
  const [showTracking, setShowTracking] = useState(false);

  const { user } = useAuth();
  const side = user?.patient_profile?.affected_side ?? null;
  const patientId = user?.patient_profile?.id ?? null;
  // "Use the muscle sensor today", remembered per patient in this browser.
  const [useSensor, setUseSensor] = useState(() => readEmgPreference(patientId));
  const checks = evaluateSetupChecks(result, side);
  const allGreen = Object.values(checks).every(Boolean);

  // Once passed it stays passed: reaching for the mouse takes the hand out of view.
  useEffect(() => {
    if (!allGreen) return;
    const timer = setTimeout(() => setPassed(true), REQUIRED_GREEN_MS);
    return () => clearTimeout(timer);
  }, [allGreen]);

  if (status.phase !== "running") return <VisionStatusCard status={status} retry={retry} />;

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-4 lg:grid-cols-3">
      <div className="relative lg:col-span-2">
        <SkeletonCanvas
          result={result}
          bodyFrame={showTracking ? tracking?.frame : null}
          highlightSide={side ?? undefined}
        />
        <p className="absolute top-2 right-3 rounded bg-black/60 px-2 text-white">
          {t("setup.performance", {
            fps: Math.round(result?.fps ?? 0),
            delegate: result?.delegate ?? "",
          })}
        </p>
      </div>
      <Card className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">{t("setup.checklist.title")}</h1>
        <Checklist checks={checks} side={side} />
        {!passed && !checks.armVisible && side && (
          <p role="status" className="text-accent text-lg font-semibold">
            {t(side === "left" ? "setup.armHint.left" : "setup.armHint.right")}
          </p>
        )}
        <Switch
          checked={useSensor}
          onChange={(on) => {
            setUseSensor(on);
            writeEmgPreference(patientId, on);
          }}
          label={t("setup.useSensor")}
        />
        <Button
          size="lg"
          disabled={!passed}
          onClick={() => void navigate(useSensor ? "/session/emg" : "/session/calibrate")}
        >
          {t("setup.continue")}
        </Button>
        {!passed && <p className="text-muted">{t("setup.checklist.hint")}</p>}
        <Button
          variant="ghost"
          aria-pressed={showTracking}
          onClick={() => setShowTracking((shown) => !shown)}
        >
          {t(showTracking ? "setup.debug.hide" : "setup.debug.show")}
        </Button>
        {showTracking && <TrackingInfo tracking={tracking} />}
      </Card>
    </div>
  );
}

export function SessionSetupPage() {
  useSessionStep("setup");
  const [allowed, setAllowed] = useState(false);

  // LiveCheck starts the camera when it mounts, so nothing runs before the patient agrees.
  return allowed ? <LiveCheck /> : <Intro onAllow={() => setAllowed(true)} />;
}
