import { X } from "lucide-react";
import { useState } from "react";
import { Outlet, useMatches, useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { QueryError } from "@/components/ui/QueryError";
import { Spinner } from "@/components/ui/Spinner";
import {
  SessionProvider,
  useEndSession,
  useForgetSession,
  useSession,
} from "@/features/session/SessionContext";
import { t, type TranslationKey } from "@/i18n";

/** Set as `handle` on each session route to name the step in the top bar. */
export interface SessionRouteHandle {
  stepKey: TranslationKey;
}

function ExitButton() {
  const navigate = useNavigate();
  const { sessionId } = useSession();
  const endSession = useEndSession();
  const forgetSession = useForgetSession();
  const [confirming, setConfirming] = useState(false);

  async function leave() {
    await navigate("/patient");
    forgetSession();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setConfirming(true)}>
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

export function SessionLayout() {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as SessionRouteHandle | undefined;

  return (
    <SessionProvider>
      <div className="bg-session-bg flex min-h-dvh flex-col text-white">
        <header className="flex items-center justify-between gap-4 px-4 py-3">
          <p className="text-xl font-semibold">{handle && t(handle.stepKey)}</p>
          <ExitButton />
        </header>
        <main className="flex flex-1 flex-col p-4">
          <SessionContent />
        </main>
      </div>
    </SessionProvider>
  );
}
