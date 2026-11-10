import type { ReachMapMarkerShape } from "@/components/ReachMap";
import type { TranslationKey } from "@/i18n";
import type { GameId, TrialOutcome } from "@/types/api";

/**
 * How each outcome is drawn. Colour and shape both differ, because amber and green are close for
 * some colour-blind readers.
 */
export const OUTCOME_STYLE: Record<
  TrialOutcome,
  { color: string; shape: ReachMapMarkerShape; labelKey: TranslationKey }
> = {
  success: { color: "var(--color-success)", shape: "circle", labelKey: "outcome.success" },
  reach_fail: { color: "var(--color-warning)", shape: "square", labelKey: "outcome.reachFail" },
  activation_fail: {
    color: "var(--color-info)",
    shape: "diamond",
    labelKey: "outcome.activationFail",
  },
  // Like a reach that did not arrive, so it shares that look.
  miss: { color: "var(--color-warning)", shape: "square", labelKey: "outcome.miss" },
  aborted: { color: "var(--color-muted)", shape: "circle", labelKey: "outcome.aborted" },
};

/** The order outcomes are listed in legends. */
export const OUTCOME_ORDER: readonly TrialOutcome[] = [
  "success",
  "reach_fail",
  "activation_fail",
  "miss",
  "aborted",
];

/** Each game's own words for an outcome, such as "Popped" for a balloon. */
const GAME_OUTCOME_KEYS: Partial<Record<GameId, Partial<Record<TrialOutcome, TranslationKey>>>> = {
  balloon_pop: { success: "outcome.popped", miss: "outcome.miss" },
  fruit_catch: { success: "outcome.caught", miss: "outcome.notCaught" },
  bloom: { success: "outcome.bloomed", miss: "outcome.notBloomed" },
};

export function outcomeLabelKey(gameId: GameId, outcome: TrialOutcome): TranslationKey {
  return GAME_OUTCOME_KEYS[gameId]?.[outcome] ?? OUTCOME_STYLE[outcome].labelKey;
}
