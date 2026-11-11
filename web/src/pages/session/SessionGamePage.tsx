import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { applyGameSetting, settingFor, useGameSettings } from "@/features/games/gameSettings";
import { GameShell } from "@/games/shared/GameShell";
import { useSession, useSessionStep } from "@/features/session/SessionContext";
import { GAMES, isGameId } from "@/games/shared/registry";
import { t } from "@/i18n";

export function SessionGamePage() {
  useSessionStep("game");
  const { gameId } = useParams();
  const navigate = useNavigate();
  const back = (
    <Button onClick={() => void navigate("/session/plan")}>{t("game.backToPlan")}</Button>
  );

  if (!isGameId(gameId)) {
    return (
      <Card className="m-auto w-full max-w-xl">
        <EmptyState title={t("game.notFound")} action={back} />
      </Card>
    );
  }
  const definition = GAMES[gameId];
  if (!definition.implemented) {
    return (
      <Card className="m-auto w-full max-w-xl">
        <EmptyState
          icon={definition.icon}
          title={t(definition.nameKey)}
          description={t("game.comingSoon")}
          action={back}
        />
      </Card>
    );
  }
  return <QueuedGame definition={definition} />;
}

/** One game of today's queue: its results screen leads to the next game, or the cool-down. */
function QueuedGame({ definition }: { definition: (typeof GAMES)[keyof typeof GAMES] }) {
  const navigate = useNavigate();
  const { gameQueue, finishGame } = useSession();
  const settings = useGameSettings();
  // The admin's defaults and trials. Without settings (the request failed), the game's own.
  const configured = useMemo(
    () => applyGameSetting(definition, settingFor(settings.data, definition.id)),
    [definition, settings.data],
  );
  const queue = gameQueue?.games ?? [];
  const position = queue.indexOf(definition.id);
  const hasNext = position >= 0 && position < queue.length - 1;
  if (settings.isPending) {
    return (
      <div className="m-auto" role="status" aria-label={t("common.loading")}>
        <Spinner size={40} />
      </div>
    );
  }
  return (
    // A new key for each game, so moving between games starts afresh.
    <GameShell
      key={definition.id}
      definition={configured}
      continueKey={hasNext ? "game.nextGame" : "game.continue"}
      onContinue={() => {
        const next = finishGame(definition.id);
        void navigate(next ? `/session/game/${next}` : "/session/cooldown");
      }}
    />
  );
}
