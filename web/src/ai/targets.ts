import type { GameParams } from "@/games/shared/types";
import type { EngineLastTrial, EngineNextResponse, GameId, TrialCreate } from "@/types/api";

/** Where the engine (L2) puts the next target: a direction or a Fruit catch side, and a distance
 * as a share of the reach. */
export interface EngineTarget {
  directionDeg: number | null;
  side: "out" | "across" | null;
  distanceFrac: number;
  sector: string | null;
}

/** The games whose targets L2 can place. */
export const TARGET_GAMES: ReadonlySet<GameId> = new Set<GameId>([
  "reach_activate",
  "balloon_pop",
  "fruit_catch",
  "pick_place",
  "path_trace",
]);

/** Pick and place's carry directions (0 outward, 1 inward, 2 up, 3 down) in degrees. */
const CARRY_DEGREES = [0, 180, 90, 270] as const;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The target in an engine answer, or null when the engine does not place targets. */
export function targetOf(response: EngineNextResponse): EngineTarget | null {
  if (!finite(response.distance_frac)) return null;
  const directionDeg = finite(response.direction_deg) ? response.direction_deg : null;
  const side = response.side ?? null;
  if (directionDeg === null && side === null) return null;
  return {
    directionDeg,
    side,
    distanceFrac: response.distance_frac,
    sector: response.sector ?? null,
  };
}

/**
 * The trial's settings with the engine's target instead of the rotation's choice. Each game
 * places it in its own terms:
 * - reach_activate: the direction and `distance_frac`;
 * - balloon_pop: the direction and `height_frac`;
 * - fruit_catch: the side, the full spread (`target_frac` 1) at `spread_frac`;
 * - pick_place: the nearest carry direction and `pick_distance_frac`;
 * - path_trace: outward (0°) or inward (180°) and `path_length_frac`.
 */
export function applyTarget(gameId: GameId, params: GameParams, target: EngineTarget): GameParams {
  const placed = { ...params };
  const { directionDeg, side, distanceFrac } = target;
  const index = directionDeg === null ? null : Math.round(directionDeg / 45) % 8;
  switch (gameId) {
    case "reach_activate":
      if (index === null) return params;
      placed.direction_index = index;
      placed.direction_deg = index * 45;
      placed.distance_frac = distanceFrac;
      return placed;
    case "balloon_pop":
      if (index === null) return params;
      placed.direction_index = index;
      placed.direction_deg = index * 45;
      placed.height_frac = distanceFrac;
      return placed;
    case "fruit_catch":
      if (side === null) return params;
      placed.target_side = side === "out" ? 1 : -1;
      placed.target_frac = 1;
      placed.spread_frac = distanceFrac;
      return placed;
    case "pick_place": {
      if (directionDeg === null) return params;
      const carry = CARRY_DEGREES.indexOf(
        ((Math.round(directionDeg / 90) * 90) % 360) as (typeof CARRY_DEGREES)[number],
      );
      if (carry < 0) return params;
      placed.carry_direction = carry;
      placed.pick_distance_frac = distanceFrac;
      return placed;
    }
    case "path_trace":
      if (directionDeg === null) return params;
      placed.direction = Math.cos((directionDeg * Math.PI) / 180) >= 0 ? 1 : -1;
      placed.path_length_frac = distanceFrac;
      return placed;
    default:
      return params;
  }
}

type Location = Pick<EngineLastTrial, "direction_deg" | "distance_frac" | "side">;

/**
 * Where a trial's target was, so L2 credits the sector actually played (the server's
 * app/engine/trial_summary.py target_location does the same). Empty for other games.
 */
export function targetLocation(gameId: GameId, record: TrialCreate): Location {
  const p = record.params as Record<string, unknown>;
  const num = (name: string) => (finite(p[name]) ? (p[name] as number) : null);
  let direction: number | null = null;
  let distance: number | null;
  let side: Location["side"] = undefined;
  switch (gameId) {
    case "reach_activate":
      direction = finite(record.target?.direction_deg)
        ? record.target.direction_deg
        : num("direction_deg");
      distance = finite(record.target?.distance_frac)
        ? record.target.distance_frac
        : num("distance_frac");
      break;
    case "balloon_pop":
      direction = num("direction_deg");
      distance = num("height_frac");
      break;
    case "fruit_catch": {
      const targetSide = num("target_side");
      const spread = num("spread_frac");
      const share = num("target_frac");
      side = targetSide === null ? undefined : targetSide > 0 ? "out" : "across";
      distance = spread !== null && share !== null ? spread * share : spread;
      break;
    }
    case "pick_place": {
      const carry = num("carry_direction");
      direction = carry === null ? null : (CARRY_DEGREES[carry] ?? null);
      distance = num("pick_distance_frac");
      break;
    }
    case "path_trace": {
      const way = num("direction");
      direction = way === null ? null : way > 0 ? 0 : 180;
      distance = num("path_length_frac");
      break;
    }
    default:
      return {};
  }
  const location: Location = {};
  if (direction !== null) location.direction_deg = ((direction % 360) + 360) % 360;
  if (distance !== null)
    location.distance_frac = Math.round(Math.min(2, Math.max(0, distance)) * 1e4) / 1e4;
  if (side !== undefined) location.side = side;
  return location;
}
