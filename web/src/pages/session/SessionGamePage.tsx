import { useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { GameShell } from "@/games/shared/GameShell";
import { GAMES, isGameId } from "@/games/shared/registry";
import { t } from "@/i18n";

export function SessionGamePage() {
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
  // A new key for each game, so moving between games starts afresh.
  return <GameShell key={gameId} definition={definition} />;
}
