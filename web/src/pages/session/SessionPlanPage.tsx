import { ArrowDown, ArrowUp, Play } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import {
  estimatedMinutes,
  playableGames,
  settingFor,
  useGameSettings,
} from "@/features/games/gameSettings";
import { defaultPlanRows, move, type PlanRow } from "@/features/session/gameQueue";
import { useSession, useSessionStep } from "@/features/session/SessionContext";
import { GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";
import { prepareAudio } from "@/lib/beep";
import type { GameId, PatientGameSetting } from "@/types/api";

/**
 * Today's games: the default plan ticked and first, other games unticked after them. Only the
 * games the admin turned on are listed, with the number of turns the admin chose. The patient
 * can tick or untick any game and change the order; Start plays the ticked ones one after
 * another. The planner (Day 13) will choose them later.
 */
export function SessionPlanPage() {
  useSessionStep("plan");
  const settings = useGameSettings();
  if (settings.isPending) {
    return (
      <div className="m-auto">
        <Spinner size={40} />
      </div>
    );
  }
  return <PlanList available={playableGames(settings.data)} settings={settings.data} />;
}

function PlanList({
  available,
  settings,
}: {
  available: GameId[];
  settings: PatientGameSetting[] | undefined;
}) {
  const navigate = useNavigate();
  const { startGames } = useSession();
  const [rows, setRows] = useState<PlanRow[]>(() => defaultPlanRows(available));
  const trialsOf = (id: GameId) => settingFor(settings, id)?.trials ?? GAMES[id].trialsDefault;
  const minutesOf = (id: GameId) => estimatedMinutes(GAMES[id], trialsOf(id));
  const chosen = rows.filter((row) => row.selected).map((row) => row.id);
  const minutes = chosen.reduce((total, id) => total + minutesOf(id), 0);

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

      {rows.length === 0 && <p className="text-lg">{t("plan.noGames")}</p>}
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
                    {t("plan.length", { targets: trialsOf(row.id), minutes: minutesOf(row.id) })}
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
    </div>
  );
}
