import { useNavigate } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";
import { prepareAudio } from "@/lib/beep";

/** Today's games. The adaptive plan replaces this simple list later. */
export function SessionPlanPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("plan.title")}</h1>
        <p className="text-white/80">{t("plan.intro")}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GAME_IDS.map((id) => {
          const game = GAMES[id];
          const Icon = game.icon;
          return (
            <li key={id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Icon size={32} aria-hidden className="text-primary shrink-0" />
                  <h2 className="text-xl font-bold">{t(game.nameKey)}</h2>
                </div>
                <p className="text-muted">{t("plan.trains", { movement: t(game.movementKey) })}</p>
                <p className="flex-1">{t(game.descriptionKey)}</p>
                {game.implemented ? (
                  <Button
                    size="lg"
                    onClick={() => {
                      // Sounds are only allowed after a click, so open audio here.
                      prepareAudio();
                      void navigate(`/session/game/${id}`);
                    }}
                  >
                    {t("plan.play")}
                  </Button>
                ) : (
                  <div>
                    <Badge>{t("game.comingSoon")}</Badge>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button variant="secondary" size="lg" onClick={() => void navigate("/session/cooldown")}>
          {t("plan.finish")}
        </Button>
      </div>
    </div>
  );
}
