import { useQuery } from "@tanstack/react-query";
import { Compass } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { GAMES } from "@/games/shared/registry";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import type { FactsNextSession } from "@/types/api";

import { directionWords, movementWords } from "./plan";

/** "Opening your hand and reaching up": the focus in plain words, or, without one, the movements
 * the planned games train. Empty when there is nothing to say. */
export function nextFocusWords(next: FactsNextSession): string[] {
  const words = [
    ...next.focus_movements.map(movementWords),
    ...next.focus_directions.map((deg) =>
      t("summary.next.direction", { direction: directionWords(deg) }),
    ),
  ];
  if (words.length > 0) return words;
  return [...new Set(next.planned_games.map((id) => t(GAMES[id].movementKey).toLowerCase()))];
}

/** A list in plain words: "a", "a and b", "a, b and c". */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return t("summary.next.list", {
    first: words.slice(0, -1).join(", "),
    last: words[words.length - 1],
  });
}

/** "Next time we'll focus on: …" from the planner's plan for the next session, once this one has
 * ended. Shows nothing until then, or if it cannot be loaded. */
export function NextFocus({ sessionId }: { sessionId: number }) {
  const facts = useQuery({
    queryKey: ["session", sessionId, "next"],
    queryFn: async () =>
      (await api.get<{ next_session: FactsNextSession | null }>(`/sessions/${sessionId}/facts`))
        .data.next_session,
    meta: SILENT,
    retry: 1,
  });
  const words = facts.data ? nextFocusWords(facts.data) : [];
  if (words.length === 0) return null;
  return (
    <Card className="flex items-start gap-4">
      <Compass size={40} aria-hidden className="text-primary shrink-0" />
      <div>
        <h2 className="text-xl font-bold">{t("summary.next.title")}</h2>
        <p className="text-lg">{t("summary.next.focus", { focus: joinWords(words) })}</p>
      </div>
    </Card>
  );
}
