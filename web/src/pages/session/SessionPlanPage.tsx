import { Play } from "lucide-react";
import { useNavigate } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";
import { prepareAudio } from "@/lib/beep";

/** Today's games. A fixed list until the planner arrives (Day 13). */
export function SessionPlanPage() {
  const navigate = useNavigate();
  const ready = GAME_IDS.filter((id) => GAMES[id].implemented);
  const comingSoon = GAME_IDS.filter((id) => !GAMES[id].implemented);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("plan.title")}</h1>
        <p className="text-white/80">{t("plan.intro")}</p>
      </div>

      <ul className="flex flex-col gap-4">
        {ready.map((id) => {
          const game = GAMES[id];
          const Icon = game.icon;
          return (
            <li key={id}>
              <Card className="flex flex-wrap items-center gap-4">
                <Icon size={48} aria-hidden className="text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold">{t(game.nameKey)}</h2>
                  <p className="text-muted">
                    {t("plan.length", {
                      targets: game.trialsDefault,
                      minutes: game.estimatedMinutes,
                    })}
                  </p>
                  <p className="mt-1">{t(game.descriptionKey)}</p>
                </div>
                <Button
                  size="lg"
                  onClick={() => {
                    // Sounds are only allowed after a click, so open audio here.
                    prepareAudio();
                    void navigate(`/session/game/${id}`);
                  }}
                >
                  <Play size={20} aria-hidden />
                  {t("plan.start")}
                </Button>
              </Card>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="coming-soon">
        <h2 id="coming-soon" className="mb-3 text-xl font-semibold">
          {t("plan.comingSoonTitle")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {comingSoon.map((id) => {
            const game = GAMES[id];
            const Icon = game.icon;
            return (
              <li key={id}>
                <Card aria-disabled="true" className="flex h-full flex-col gap-2 opacity-75">
                  <div className="flex items-center gap-2">
                    <Icon size={24} aria-hidden className="text-muted shrink-0" />
                    <h3 className="font-bold">{t(game.nameKey)}</h3>
                  </div>
                  <p className="text-muted text-base">{t(game.movementKey)}</p>
                  <div className="mt-auto">
                    <Badge>{t("game.comingSoon")}</Badge>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex justify-end">
        <Button variant="secondary" size="lg" onClick={() => void navigate("/session/cooldown")}>
          {t("plan.finish")}
        </Button>
      </div>
    </div>
  );
}
