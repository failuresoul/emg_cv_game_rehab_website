import { X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { t } from "@/i18n";

import { useEndSession, useForgetSession, useSession } from "./SessionContext";
import { stopSession } from "./stopSession";

/** Leaves the session pages: stops the camera and game loops, then goes home. */
function useLeaveSession() {
  const navigate = useNavigate();
  const forgetSession = useForgetSession();
  return async () => {
    stopSession();
    await navigate("/patient");
    forgetSession();
  };
}

/** Exit from any step: confirm, end the session as aborted, stop everything, go home. */
export function SessionExitButton({ variant = "secondary" }: { variant?: "secondary" | "ghost" }) {
  const { sessionId } = useSession();
  const endSession = useEndSession();
  const leave = useLeaveSession();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button variant={variant} onClick={() => setConfirming(true)}>
        <X size={20} aria-hidden />
        {t("session.exit")}
      </Button>
      <Modal
        open={confirming}
        title={t("session.exitConfirm.title")}
        onClose={() => setConfirming(false)}
      >
        <p>{t("session.exitConfirm.body")}</p>
        {endSession.isError && (
          <p role="alert" className="text-danger mt-3 font-medium">
            {t("session.exitConfirm.error")}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {t("session.exitConfirm.stay")}
          </Button>
          <Button
            variant="danger"
            loading={endSession.isPending}
            onClick={() => {
              if (sessionId === null) {
                void leave();
                return;
              }
              // A finished session is already completed; ending it again changes nothing.
              endSession.mutate(
                { sessionId, status: "aborted" },
                { onSuccess: () => void leave() },
              );
            }}
          >
            {t("session.exitConfirm.leave")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
