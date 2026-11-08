import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { t } from "@/i18n";

export const REST_SECONDS = 20;

/** A short rest with a slowly breathing circle, which keeps still for reduced motion. */
export function RestScreen({ nextName, onDone }: { nextName: string; onDone: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(REST_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, onDone]);

  return (
    <Card className="m-auto flex w-full max-w-xl flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-bold">{t("warmup.rest.title")}</h1>
      <div className="flex size-56 items-center justify-center" aria-hidden>
        <div className="bg-primary/30 border-primary motion-safe:animate-breathe size-56 rounded-full border-4" />
      </div>
      <p className="text-lg font-medium">{t("warmup.rest.breathe")}</p>
      <p aria-live="off" className="text-muted text-xl tabular-nums">
        {t("warmup.rest.seconds", { seconds: secondsLeft })}
      </p>
      <p className="font-medium">{t("warmup.rest.next", { name: nextName })}</p>
      <Button size="lg" variant="secondary" onClick={onDone}>
        {t("warmup.rest.skip")}
      </Button>
    </Card>
  );
}
