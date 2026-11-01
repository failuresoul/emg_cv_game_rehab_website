import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { t, type TranslationKey } from "@/i18n";

import type { VisionErrorCode, VisionStatus } from "./visionEngine";

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

/** Shown instead of the live view while the camera is starting or has failed. */
export function VisionStatusCard({ status, retry }: { status: VisionStatus; retry: () => void }) {
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
