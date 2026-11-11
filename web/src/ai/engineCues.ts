import type { TranslationKey } from "@/i18n";
import type { EngineCue } from "@/types/api";

import type { FeedbackTone } from "@/games/shared/types";

/** What the game does for each cue from the engine's safety layer. Never a word about "AI". */
export type CueAction =
  | { kind: "message"; key: TranslationKey; tone: FeedbackTone }
  | { kind: "rest" }
  | { kind: "banner"; key: TranslationKey }
  | { kind: "finish" };

export function cueAction(cue: EngineCue): CueAction {
  switch (cue) {
    case "posture":
      // The warm-up's own reminder.
      return { kind: "message", key: "warmup.cue.back", tone: "gentle" };
    case "encourage":
      return { kind: "message", key: "game.cue.encourage", tone: "gentle" };
    case "rest":
      return { kind: "rest" };
    case "finish_soon":
      return { kind: "banner", key: "game.cue.finishSoon" };
    case "finish":
      return { kind: "finish" };
  }
}

/** How long the rest pause lasts before "Continue" is suggested. */
export const REST_SECONDS = 30;
/** At most one level message in this time, so the patient is not told after every trial. */
export const LEVEL_MESSAGE_GAP_MS = 30_000;

/**
 * Words for a change of level: "a little more challenge" up, "a bit easier" down. At most one
 * message every 30 s; the HUD's "Level N" changes every time.
 */
export class LevelMessages {
  private lastShownMs: number | null = null;

  message(previous: number | null, next: number, nowMs: number): TranslationKey | null {
    if (previous === null || previous === next) return null;
    if (this.lastShownMs !== null && nowMs - this.lastShownMs < LEVEL_MESSAGE_GAP_MS) return null;
    this.lastShownMs = nowMs;
    return next > previous ? "game.level.up" : "game.level.down";
  }
}
