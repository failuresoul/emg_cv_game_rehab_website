import {
  bestFinger,
  DETAIL_BEST_FINGER,
  DETAIL_NOTE_HIT_RATE,
  FINGER_LABEL_KEYS,
  fingerHitRateDetail,
  fingerTallies,
} from "@/features/games/results";
import { CompensationTally } from "@/games/shared/compensationTally";
import { Encourager } from "@/games/shared/encourage";
import { summariseTrials } from "@/games/shared/metrics";
import type {
  GameContext,
  GameHudItem,
  GameInstance,
  GameParams,
  GameResult,
} from "@/games/shared/types";
import { t } from "@/i18n";
import { type Finger, type FingerTouchEvent, FINGERS } from "@/input/fingerTouch";
import type { TrialCreate } from "@/types/api";

import { generateMelody } from "./melody";
import { FALL_MS, MelodyMachine } from "./melodyMachine";
import { type FingerPianoParams, melodyToParams, readParams } from "./params";
import {
  drawBackground,
  drawHand,
  drawLanes,
  drawNote,
  drawPreview,
  drawRing,
  FINGER_COLOURS,
  noteY,
  pianoLayout,
} from "./render";
import { buildMelodyRecord, melodyMetrics, melodyScore } from "./trialRecord";

/** A played note's ring shows this long; a missed note fades below the line in this time. */
const EFFECT_MS = 700;
const DEFAULT_LENGTH = 4;

interface ActiveMelody {
  no: number;
  params: GameParams;
  settings: FingerPianoParams;
  machine: MelodyMachine;
  compensation: CompensationTally;
}

interface Effect {
  finger: Finger;
  /** The lane colour for a hit; null (grey) for a wrong finger. */
  colour: string | null;
  startMs: number;
}

export function createFingerPianoGame(context: GameContext): GameInstance {
  const records: TrialCreate[] = [];
  const encourager = new Encourager(context.rng.next);
  let score = 0;
  let notesHit = 0;
  let notesPlayed = 0;
  let melody: ActiveMelody | null = null;
  let paused = false;
  let started = false;
  let nowMs = 0;
  let touches: FingerTouchEvent[] = [];
  let effects: Effect[] = [];
  let unsubscribe: (() => void) | null = null;
  const labels = Object.fromEntries(
    FINGERS.map((finger) => [finger, t(FINGER_LABEL_KEYS[finger])]),
  ) as Record<Finger, string>;

  function spawn(no: number, at: number): void {
    let params = context.params.next(no);
    let settings = readParams(params);
    if (settings.notes.length === 0) {
      // A provider that sent no melody: make one here, with the same rules.
      const length = Number.isFinite(params.sequence_length)
        ? params.sequence_length
        : DEFAULT_LENGTH;
      params = {
        ...params,
        ...melodyToParams(generateMelody(context.rng, settings.fingers, length)),
      };
      settings = readParams(params);
    }
    context.hand.setTouchThreshold(settings.touchThreshold);
    melody = {
      no,
      params,
      settings,
      machine: new MelodyMachine(settings, at),
      compensation: new CompensationTally(),
    };
    touches = [];
    context.emit({ key: "game.finger_piano.prompt.watch", tone: "neutral" });
  }

  function finishTrial(current: ActiveMelody, at: number): void {
    const { machine } = current;
    const record = buildMelodyRecord({
      trialNo: current.no,
      params: current.params,
      notes: machine.notes,
      spawnMs: machine.spawnMs,
      endMs: at,
      compensation: current.compensation.toRecord(),
    });
    records.push(record);
    context.logger.log(record);
    const metrics = melodyMetrics(machine.notes);
    score += melodyScore(metrics);
    notesHit += metrics.hits;
    notesPlayed += metrics.notesTotal;
    context.emit(record.outcome === "success" ? encourager.success() : encourager.miss());
  }

  return {
    start() {
      started = true;
      unsubscribe ??= context.hand.subscribeTouch((event) => {
        if (event.type === "touchStart" && started && !paused) touches.push(event);
      });
    },

    update(_dtMs, now) {
      nowMs = now;
      if (!started || paused) return;
      if (!melody) {
        if (records.length >= context.trialsPlanned) return;
        spawn(records.length + 1, now);
      }
      const current = melody as ActiveMelody;
      const { machine } = current;

      if (machine.isLive) {
        const reading = context.compensation.reading;
        current.compensation.add(reading.sustained, reading.values);
      }

      // Touches first, so a touch made just before a window closed still counts for it.
      const queued = touches;
      touches = [];
      const events = queued.flatMap((touch) => machine.touch(touch.finger, touch.t));
      events.push(...machine.update(now));

      for (const event of events) {
        if (event.type === "hit") {
          context.audio.note(FINGERS.indexOf(event.finger));
          effects.push({
            finger: event.finger,
            colour: FINGER_COLOURS[event.finger],
            startMs: now,
          });
        }
        if (event.type === "wrong") {
          context.audio.muted();
          effects.push({ finger: event.finger, colour: null, startMs: now });
        }
        if (event.type === "phase" && event.phase === "PLAY") {
          context.emit({ key: "game.finger_piano.prompt.play", tone: "neutral" });
        }
        if (event.type === "outcome") finishTrial(current, now);
      }
      effects = effects.filter((effect) => now - effect.startMs < EFFECT_MS);
      if (machine.phase === "DONE") melody = null;
    },

    renderBackground(context2d) {
      drawBackground(context2d, context.width, context.height);
    },

    render(context2d) {
      const fingers = melody?.settings.fingers ?? [...FINGERS];
      const layout = pianoLayout(context.width, context.height, fingers, context.affectedSide);
      drawLanes(context2d, layout, context.height, labels);
      const radius = layout.laneWidth * 0.28;
      let lit: Finger | null = null;

      if (melody) {
        const { machine } = melody;
        if (machine.phase === "PREVIEW") {
          const notes = machine.notes.map((note) => note.finger);
          const share = (nowMs - machine.spawnMs) / Math.max(1, melody.settings.previewMs);
          const current = Math.min(notes.length - 1, Math.max(0, Math.floor(share * notes.length)));
          lit = notes[current] ?? null;
          drawPreview(context2d, context.width / 2, layout.topY + 30, notes, current, radius * 0.6);
        } else if (machine.phase === "PLAY") {
          lit = machine.nextNote?.finger ?? null;
          for (const note of machine.notes) {
            const x = layout.laneX[note.finger];
            if (x === undefined || note.status === "hit") continue;
            const ahead = note.arrivalMs - nowMs;
            if (ahead > FALL_MS) continue;
            // A note not played slides on past the line and fades.
            const past = note.status === "pending" ? 0 : -ahead / EFFECT_MS;
            if (past >= 1) continue;
            drawNote(
              context2d,
              { x, y: noteY(layout, note.arrivalMs, nowMs) },
              radius,
              note.finger,
              1 - Math.max(0, past) * 0.8,
            );
          }
        }
      }

      for (const effect of effects) {
        const x = layout.laneX[effect.finger];
        if (x === undefined) continue;
        drawRing(
          context2d,
          { x, y: layout.hitY },
          radius,
          effect.colour,
          (nowMs - effect.startMs) / EFFECT_MS,
        );
      }
      drawHand(context2d, layout, lit, context.hand.getTouch());
    },

    pause() {
      paused = true;
      touches = [];
    },

    resume() {
      paused = false;
      touches = [];
      // A melody cut short by a pause starts again, with a new preview.
      if (melody?.machine.isLive) melody = null;
    },

    isFinished: () => records.length >= context.trialsPlanned && melody === null,

    getSummary(): GameResult {
      const tallies = fingerTallies(records);
      return {
        score,
        trialsDone: records.length,
        trialsPlanned: context.trialsPlanned,
        summary: {
          ...summariseTrials(records),
          details: {
            [DETAIL_NOTE_HIT_RATE]:
              notesPlayed > 0 ? Math.round((notesHit / notesPlayed) * 10000) / 10000 : null,
            [DETAIL_BEST_FINGER]: bestFinger(tallies),
            ...Object.fromEntries(
              tallies.map((tally) => [
                fingerHitRateDetail(tally.finger),
                Math.round((tally.hits / tally.attempts) * 10000) / 10000,
              ]),
            ),
          },
        },
      };
    },

    getHudItems(): GameHudItem[] {
      return [{ key: "game.hud.notes", params: { n: notesHit } }];
    },

    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      melody = null;
      touches = [];
      effects = [];
    },
  };
}
