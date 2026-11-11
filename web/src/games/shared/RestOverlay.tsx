import { Play } from "lucide-react";
import { useEffect, useState } from "react";

import { REST_SECONDS } from "@/ai/engineCues";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { t } from "@/i18n";

/**
 * A short rest the game suggested: a slowly breathing circle (still for anyone who prefers
 * reduced motion), the seconds left, and Continue whenever the patient is ready.
 */
export function RestOverlay({ onContinue }: { onContinue: () => void }) {
  const [left, setLeft] = useState(REST_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
      <Card
        className="flex w-full max-w-lg flex-col items-center gap-5 text-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rest-title"
      >
        <h2 id="rest-title" className="text-2xl font-bold">
          {t("game.rest.title")}
        </h2>
        <div
          aria-hidden
          className="bg-primary/20 border-primary motion-safe:animate-breathe size-32 rounded-full border-4"
        />
        <p>{t("game.rest.breathe")}</p>
        <p className="text-muted tabular-nums" aria-live="polite">
          {left > 0 ? t("game.rest.seconds", { n: left }) : t("game.rest.ready")}
        </p>
        <Button size="lg" onClick={onContinue}>
          <Play size={20} aria-hidden />
          {t("game.rest.continue")}
        </Button>
      </Card>
    </div>
  );
}
