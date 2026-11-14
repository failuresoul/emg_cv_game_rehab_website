import { ArrowDown, ArrowUp, Feather, Lightbulb, Play, RotateCcw } from "lucide-react";
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
import {
  changedFromPlan,
  planRows,
  reasonText,
  sendPlanOverride,
  useSessionPlan,
} from "@/features/session/plan";
import { useSession, useSessionStep } from "@/features/session/SessionContext";
import { GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";
import { prepareAudio } from "@/lib/beep";
import type { GameId, PatientGameSetting, SessionPlan } from "@/types/api";

/**
 * Today's games, as the planner recommends them: in order, each with what it trains, its turns
 * and minutes, and why it was chosen. The patient can still untick or reorder games ("Use
 * recommended plan" puts the plan back); changes are recorded for analysis. Without a plan (it
 * could not be loaded) the default list is shown instead.
 */
export function SessionPlanPage() {
  useSessionStep("plan");
  const { sessionId } = useSession();
  const settings = useGameSettings();
  const plan = useSessionPlan(sessionId);
  if (settings.isPending || (plan.isPending && sessionId !== null)) {
    return (
      <div className="m-auto" role="status" aria-label={t("common.loading")}>
        <Spinner size={40} />
      </div>
    );
  }
  return (
    <PlanList
      available={playableGames(settings.data)}
      settings={settings.data}
      plan={plan.data}
      sessionId={sessionId}
    />
  );
}

function PlanList({
  available,
  settings,
  plan,
  sessionId,
}: {
  available: GameId[];
  settings: PatientGameSetting[] | undefined;
  plan: SessionPlan | undefined;
  sessionId: number | null;
}) {
  const navigate = useNavigate();
  const { startGames } = useSession();
  const recommended = () => (plan ? planRows(plan, available) : defaultPlanRows(available));
  const [rows, setRows] = useState<PlanRow[]>(recommended);
  const planned = new Map(plan?.games.map((game) => [game.game_id, game]) ?? []);
  const trialsOf = (id: GameId) =>
    planned.get(id)?.trials ?? settingFor(settings, id)?.trials ?? GAMES[id].trialsDefault;
  const minutesOf = (id: GameId) => estimatedMinutes(GAMES[id], trialsOf(id));
  const chosen = rows.filter((row) => row.selected).map((row) => row.id);
  const minutes = chosen.reduce((total, id) => total + minutesOf(id), 0);
  const changed = changedFromPlan(rows, plan);
  const lighter = plan?.notes.some((note) => note.key === "lighter_today") ?? false;
  const locked = plan?.locked === true;

  function start() {
    if (chosen.length === 0) return;
    // Sounds are only allowed after a click, so open audio here.
    prepareAudio();
    if (changed && sessionId !== null) void sendPlanOverride(sessionId, chosen);
    const trials = Object.fromEntries(
      chosen.filter((id) => planned.has(id)).map((id) => [id, trialsOf(id)]),
    );
    startGames(chosen, trials);
    void navigate(`/session/game/${chosen[0]}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("plan.title")}</h1>
        <p className="text-white/80">{plan ? t("plan.introPlanned") : t("plan.intro")}</p>
      </div>

      {lighter && (
        <p role="note" className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 text-lg">
          <Feather size={24} aria-hidden className="shrink-0" />
          {t("plan.lighterNote")}
        </p>
      )}

      {locked && (
        <p role="note" className="rounded-xl bg-white/10 px-4 py-3 text-lg">
          {t("plan.lockedNote")}
        </p>
      )}

      {rows.length === 0 && <p className="text-lg">{t("plan.noGames")}</p>}
      <ol className="flex flex-col gap-3" aria-label={t("plan.listLabel")}>
        {rows.map((row, index) => {
          const game = GAMES[row.id];
          const Icon = game.icon;
          const name = t(game.nameKey);
          const checkboxId = `plan-${row.id}`;
          const reason = planned.get(row.id);
          return (
            <li key={row.id}>
              <Card className="flex flex-wrap items-center gap-4">
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={row.selected}
                  disabled={locked}
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
                  {reason ? (
                    <span className="text-primary mt-1 flex items-start gap-2 font-medium">
                      <Lightbulb size={20} aria-hidden className="mt-0.5 shrink-0" />
                      <span>
                        <span className="sr-only">{t("plan.why")} </span>
                        {reasonText(reason)}
                      </span>
                    </span>
                  ) : (
                    <span className="mt-1 block">{t(game.descriptionKey)}</span>
                  )}
                </label>
                <div className={locked ? "hidden" : "flex gap-2"}>
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
          {plan && changed && (
            <Button variant="secondary" size="lg" onClick={() => setRows(recommended())}>
              <RotateCcw size={20} aria-hidden />
              {t("plan.useRecommended")}
            </Button>
          )}
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
