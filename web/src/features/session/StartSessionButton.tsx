import { Play } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";

import { useStartSession } from "./SessionContext";

export function StartSessionButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const startSession = useStartSession();

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
