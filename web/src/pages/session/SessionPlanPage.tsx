import { ArrowDown, ArrowUp, Play } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { move } from "@/features/session/gameQueue";
import { useSession } from "@/features/session/SessionContext";
import { GAME_IDS, GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";
import { prepareAudio } from "@/lib/beep";
import type { GameId } from "@/types/api";

const READY = GAME_IDS.filter((id) => GAMES[id].implemented);

interface PlanRow {
  id: GameId;
  selected: boolean;
}

/**
 * Today's games, all ticked, in the default order. The patient can leave a game out or change the
 * order; Start plays them one after another. The planner (Day 13) will choose them later.
 */
export function SessionPlanPage() {
  const navigate = useNavigate();
  const { startGames } = useSession();
  const [rows, setRows] = useState<PlanRow[]>(() => READY.map((id) => ({ id, selected: true })));
  const chosen = rows.filter((row) => row.selected).map((row) => row.id);
  const minutes = chosen.reduce((total, id) => total + GAMES[id].estimatedMinutes, 0);
  const comingSoon = GAME_IDS.filter((id) => !GAMES[id].implemented);

  function start() {
    if (chosen.length === 0) return;
    // Sounds are only allowed after a click, so open audio here.
    prepareAudio();
    startGames(chosen);
    void navigate(`/session/game/${chosen[0]}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("plan.title")}</h1>
        <p className="text-white/80">{t("plan.intro")}</p>
      </div>

      <ol className="flex flex-col gap-3" aria-label={t("plan.listLabel")}>
        {rows.map((row, index) => {
          const game = GAMES[row.id];
          const Icon = game.icon;
          const name = t(game.nameKey);
          const checkboxId = `plan-${row.id}`;
          return (
            <li key={row.id}>
              <Card className="flex flex-wrap items-center gap-4">
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={row.selected}
                  onChange={() =>
                    setRows((current) =>
                      current.map((item) =>
                        item.id === row.id ? { ...item, selected: !item.selected } : item,
                      ),
                    )
                  }
                  className="accent-primary size-7 shrink-0 cursor-pointer"
                />
                <Icon
                  size={44}
                  aria-hidden
                  className={row.selected ? "text-primary shrink-0" : "text-muted shrink-0"}
                />
                <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block text-xl font-bold">{name}</span>
                  <span className="text-muted block">
                    {t("plan.trains", { movement: t(game.movementKey) })} ·{" "}
                    {t("plan.length", {
                      targets: game.trialsDefault,
                      minutes: game.estimatedMinutes,
                    })}
                  </span>
                  <span className="mt-1 block">{t(game.descriptionKey)}</span>
                </label>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    aria-label={t("plan.moveUp", { name })}
                    disabled={index === 0}
                    onClick={() => setRows((current) => move(current, index, -1))}
                  >
                    <ArrowUp size={20} aria-hidden />
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={t("plan.moveDown", { name })}
                    disabled={index === rows.length - 1}
                    onClick={() => setRows((current) => move(current, index, 1))}
                  >
                    <ArrowDown size={20} aria-hidden />
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-lg font-semibold" aria-live="polite">
          {chosen.length === 0
            ? t("plan.noneChosen")
            : t("plan.total", { games: chosen.length, minutes })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="lg" onClick={() => void navigate("/session/cooldown")}>
            {t("plan.finish")}
          </Button>
          <Button size="lg" disabled={chosen.length === 0} onClick={start}>
            <Play size={20} aria-hidden />
            {t("plan.start")}
          </Button>
        </div>
      </div>

      <section aria-labelledby="coming-soon">
        <h2 id="coming-soon" className="mb-3 text-xl font-semibold">
          {t("plan.comingSoonTitle")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
