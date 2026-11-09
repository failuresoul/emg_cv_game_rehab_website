import { playBeep, playChime, playPlop, playStar, playTick, prepareAudio } from "@/lib/beep";

/** The warm-up's soft sounds, for games. Each does nothing when sound is unavailable or muted. */
export interface GameAudio {
  /** Call from a click: browsers only allow sound after the user has interacted. */
  prepare(): void;
  /** Each countdown number. */
  countdown(): void;
  /** A small step, such as entering a target. */
  tick(): void;
  /** A trial done well; the note climbs with `step`. */
  success(step?: number): void;
  /** Something missed landing softly, never a harsh "wrong" sound. */
  plop(): void;
  /** The end of a game. */
  finish(): void;
}

export const gameAudio: GameAudio = {
  prepare: prepareAudio,
  countdown: playBeep,
  tick: playTick,
  success: (step = 0) => playStar(step),
  plop: playPlop,
  finish: playChime,
};
