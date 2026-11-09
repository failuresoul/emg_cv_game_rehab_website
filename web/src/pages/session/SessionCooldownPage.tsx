import { Wind } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useEndSession, useSession } from "@/features/session/SessionContext";
import { t } from "@/i18n";

/** A short rest before the summary. Guided cool-down exercises come later. */
export function SessionCooldownPage() {
  const navigate = useNavigate();
  const { sessionId } = useSession();
  const endSession = useEndSession();

  function finish() {
    if (sessionId === null) {
      void navigate("/session/summary");
      return;
    }
    endSession.mutate(
      { sessionId, status: "completed" },
      { onSuccess: () => void navigate("/session/summary") },
    );
  }

  return (
    <Card className="m-auto flex w-full max-w-xl flex-col items-center gap-4 text-center">
      <Wind size={48} aria-hidden className="text-primary" />
      <h1 className="text-2xl font-bold">{t("cooldown.title")}</h1>
      <p>{t("cooldown.body")}</p>
      {endSession.isError && (
        <p role="alert" className="text-danger font-medium">
          {t("cooldown.error")}
        </p>
      )}
      <Button size="lg" loading={endSession.isPending} onClick={finish}>
        {t("cooldown.finish")}
      </Button>
    </Card>
  );
}
