// Matches the schemas in server/app/schemas/.

export type Role = "admin" | "patient";
export type Side = "left" | "right";
export type AgeBand = "18-29" | "30-39" | "40-49" | "50-59" | "60-69" | "70+";
export type Language = "en" | "bn";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface PatientProfile {
  id: number;
  user_id: number;
  patient_code: string;
  affected_side: Side;
  dominant_side: Side;
  age_band: AgeBand;
  months_since_stroke: number | null;
  language: Language;
  notes: string | null;
  /** Sessions per week the patient aims for; the therapist sets it. */
  weekly_goal: number;
  /** A demo patient with synthetic data, from server/scripts/seed_demo_data.py. */
  is_demo: boolean;
  /** Which parameter engine sets the games' difficulty. Older servers leave it out: L0. */
  engine_mode?: EngineMode;
  created_at: string;
}

/** L0 fixed settings; L1 the staircase; L2 (Day 13) the model-based engine. */
export type EngineMode = "L0" | "L1" | "L2";

export type EngineCue = "posture" | "encourage" | "rest" | "finish_soon" | "finish";

/** The summary of the last trial the engine learns from. */
export interface EngineLastTrial {
  trial_no: number;
  outcome: TrialOutcome;
  failure_type: "reach_fail" | "activation_fail" | "miss" | null;
  compensated: boolean;
  movement_ms: number | null;
  completion_ms: number | null;
  activation_peak: number | null;
  /** Where the target was (spatial games), so L2 credits the sector played. */
  direction_deg?: number;
  distance_frac?: number;
  side?: "out" | "across";
}

export interface EngineNextResponse {
  params: Record<string, number>;
  /** 1–10, from the mean difficulty. */
  level: number;
  cue: EngineCue | null;
  /** For the admin and research only; never shown to patients. */
  decision: string;
  safety_override: string | null;
  engine: string;
  /** Where the next target goes, when the engine chooses it (L2, spatial games); else null. */
  direction_deg?: number | null;
  distance_frac?: number | null;
  /** The workspace sector, such as "D2R3" or "out-R2". */
  sector?: string | null;
  side?: "out" | "across" | null;
}

export interface Me extends User {
  patient_profile: PatientProfile | null;
}

export interface PatientUser {
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
}

export interface Patient extends PatientProfile {
  user: PatientUser;
}

export interface PatientCreate {
  email: string;
  full_name: string;
  password: string;
  affected_side: Side;
  dominant_side: Side;
  age_band: AgeBand;
  months_since_stroke?: number | null;
  language?: Language;
  notes?: string | null;
  weekly_goal?: number;
}

export type PatientUpdate = Partial<PatientCreate> & { engine_mode?: EngineMode };

export type PatientRegister = Omit<PatientCreate, "notes">;

export interface AdminStats {
  total_patients: number;
  active_patients: number;
  sessions_today: number;
  open_alerts: number;
}

export interface TodayPlanStep {
  step: string;
  minutes: number;
}

export type SessionStatus = "active" | "completed" | "aborted";
export type PointPair = [number, number];

export interface DeviceInfo {
  browser?: string | null;
  fps?: number | null;
  delegate?: "GPU" | "CPU" | null;
  /** The muscle sensor, when the session uses it. */
  emg?: EmgDeviceInfo | null;
}

export type EmgSite = "flexors" | "extensors";

export interface EmgDeviceInfo {
  connected: boolean;
  source?: "serial" | "simulated" | null;
  site?: EmgSite | null;
  firmware_version?: string | null;
}

export type SessionStep =
  "setup" | "emg" | "calibrate" | "warmup" | "plan" | "game" | "cooldown" | "summary";

/** Today's games in order and the one being played; index equals games.length once done. */
export interface GameQueueState {
  games: GameId[];
  index: number;
  /** Trials per game from the plan, where it set them. */
  trials?: Partial<Record<GameId, number>>;
}

export interface SessionProgressUpdate {
  current_step?: SessionStep;
  game_queue?: GameQueueState;
}

export interface SessionRecord {
  id: number;
  patient_id: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  device_info: DeviceInfo | null;
  notes: string | null;
  /** Where the patient is, so a refresh or a return resumes there. */
  current_step: SessionStep;
  game_queue: GameQueueState | null;
}

export interface CalibrationQuality {
  valid: boolean[];
  retries: number;
  max_trunk_displacement_sw: number;
}

export interface CalibrationCreate {
  affected_side: Side;
  shoulder_width_px: number;
  directions_deg: number[];
  reach_radii_sw: number[];
  reach_points_sw: PointPair[];
  hull_sw: PointPair[];
  hull_area_sw2: number;
  quality: CalibrationQuality;
}

export interface Calibration extends CalibrationCreate {
  id: number;
  session_id: number;
  created_at: string;
}

export interface SessionSummary extends SessionRecord {
  duration_seconds: number | null;
  hull_area_sw2: number | null;
  warmup_summary: WarmupSummary | null;
  /** Finished game runs, in the order they were played. */
  games?: LastSessionGame[];
}

export interface SessionDetail extends SessionSummary {
  calibration: Calibration | null;
}

export interface AdminCalibration {
  id: number;
  session_id: number;
  created_at: string;
  reach_radii_sw: number[];
  hull_sw: PointPair[];
  hull_area_sw2: number;
}

export interface LastSession {
  date: string;
  status: SessionStatus;
  duration_seconds: number | null;
  warmup_summary?: WarmupSummary | null;
  /** Finished game runs, in the order they were played. */
  games?: LastSessionGame[];
}

export type WarmupExerciseId =
  | "shoulder_flexion"
  | "shoulder_abduction"
  | "elbow_flexion"
  | "forward_reach"
  | "hand_open_close"
  | "thumb_opposition";
export type WarmupPreset = "standard" | "gentle" | "personal";
export type ThresholdUnit = "deg" | "arm_ratio" | "palm_ratio";

export interface WarmupThresholds {
  low: number;
  high: number;
  unit: ThresholdUnit;
}

export interface WarmupPersonalisation {
  previous_high: number | null;
  new_high: number;
  reason: string;
}

export interface WarmupRep {
  index: number;
  peak: number;
  duration_ms: number;
  compensated: boolean;
  compensation_type: string | null;
}

export interface WarmupResultCreate {
  exercise_id: WarmupExerciseId;
  preset: WarmupPreset;
  thresholds: WarmupThresholds;
  personalisation: WarmupPersonalisation | null;
  full_reps: number;
  partial_reps: number;
  target_reps: number;
  best_peak: number | null;
  mean_duration_ms: number | null;
  active_time_ms: number;
  paused_time_ms: number;
  measure_source: "3d" | "2d" | null;
  trunk_reference: "hip" | "vertical" | "n/a" | null;
  compensated_reps: number;
  compensation_rate: number;
  reps: WarmupRep[];
  skipped: boolean;
}

export interface WarmupResult extends WarmupResultCreate {
  id: number;
  session_id: number;
  created_at: string;
}

export interface WarmupSummary {
  exercises_done: number;
  /** Every exercise with a result, skipped or not. */
  exercises_total: number;
  total_reps: number;
  goals_reached: number;
  mean_compensation_rate: number | null;
}

export interface LastWarmup extends WarmupSummary {
  session_id: number;
  date: string;
}

export interface AdminWarmupPoint {
  session_id: number;
  date: string;
  preset: WarmupPreset;
  best_peak: number | null;
  target_high: number;
  thresholds: WarmupThresholds;
  full_reps: number;
  target_reps: number;
  goal_reached: boolean;
  compensation_rate: number;
  personalisation: WarmupPersonalisation | null;
}

export interface AdminWarmupHistory {
  exercise_id: WarmupExerciseId;
  /** Oldest first. */
  points: AdminWarmupPoint[];
}

export interface LatestCalibration {
  hull_sw: PointPair[];
  hull_area_sw2: number;
}

export interface PatientDashboard {
  profile: PatientProfile;
  today_plan: TodayPlanStep[];
  last_session: LastSession | null;
  latest_calibration: LatestCalibration | null;
  last_warmup: LastWarmup | null;
  streak_days: number;
}

export type GameId =
  | "reach_activate"
  | "balloon_pop"
  | "fruit_catch"
  | "bloom"
  | "finger_piano"
  | "path_trace"
  | "paint_wall"
  | "pick_place"
  | "grip_hold";
export type GameEngine = "L0" | "L1" | "L2";
export type InputSource = "cv_grip" | "keyboard" | "emg";
export type GameRunStatus = "active" | "completed" | "aborted";
/** "miss" is for games where a target leaves by itself, such as a balloon floating away. */
export type TrialOutcome = "success" | "reach_fail" | "activation_fail" | "miss" | "aborted";
/** [t_ms relative to spawn, x_sw, y_sw]: the raw fingertip in the body frame. */
export type TrajectoryPoint = [number, number, number];

export interface GameRunStart {
  game_id: GameId;
  engine: GameEngine;
  input_source: InputSource;
  params_initial: Record<string, number>;
  trials_planned: number;
}

/** A target placed in the body frame, for reaching games. */
export interface SpatialTrialTarget {
  /** Optional for placed targets. */
  kind?: string;
  x_sw: number;
  y_sw: number;
  radius_sw: number;
  direction_deg: number;
  distance_frac: number;
  /** Direction and ring, for example "D3R2". */
  sector: string;
  notes?: string[];
  shape?: string;
  points?: PointPair[];
  index?: number;
  target_frac?: number;
  pick?: PointPair;
  place?: PointPair;
  object_radius_sw?: number;
  box_size_sw?: number;
  center?: number;
  width?: number;
}

/**
 * A target with no place, for hand games: {kind: "bloom"} or {kind: "sequence", notes: [...]}.
 * The kind is lower-case letters, digits and underscores, up to 30; each note up to 20 characters.
 */
export interface KindTrialTarget {
  kind: string;
  /** Up to 64, for example finger names in the order to play them. */
  notes?: string[];
  /** A drawn target's shape, such as "s_curve" for a path. */
  shape?: string;
  /** A drawn target's points in SW, such as a path to follow: 2 to 200. */
  points?: PointPair[];
  /** A target's place in a row, such as a wall stripe's, from 0. */
  index?: number;
  /** A target's height or size as a share, 0–1, such as a stripe's share of the elbow range. */
  target_frac?: number;
  /** Carrying games: where the object is picked up and where it is put down, in SW. */
  pick?: PointPair;
  place?: PointPair;
  /** Carrying games: the object's radius and the box's width, in SW. */
  object_radius_sw?: number;
  box_size_sw?: number;
  /** Level games: the middle and the width of the band of levels to hold, 0–1. */
  center?: number;
  width?: number;
  x_sw?: never;
  y_sw?: never;
  radius_sw?: never;
  direction_deg?: never;
  distance_frac?: never;
  sector?: never;
}

export type TrialTarget = SpatialTrialTarget | KindTrialTarget;

export function isSpatialTarget(
  target: TrialTarget | null | undefined,
): target is SpatialTrialTarget {
  return target !== null && target !== undefined && target.x_sw !== undefined;
}

/** Milliseconds relative to spawn; null when the trial never reached that moment. */
export interface TrialTimings {
  spawn: number;
  move_onset: number | null;
  enter: number | null;
  dwell_done: number | null;
  activation_start: number | null;
  activation_done: number | null;
  end: number | null;
}

export interface TrialMetrics {
  reaction_ms: number | null;
  movement_ms: number | null;
  path_length_sw: number | null;
  straight_dist_sw: number | null;
  path_efficiency: number | null;
  peak_speed_sw_s: number | null;
  activation_latency_ms: number | null;
  activation_peak: number | null;
  /** The highest the affected arm was raised during the trial, in degrees; for raising games. */
  peak_arm_elevation_deg?: number | null;
  /** Side-to-side games: how far the hand had to move at the start, along x. */
  lateral_distance_sw?: number | null;
  /** Side-to-side games: straight sideways distance over sideways path length, 0–1. */
  lateral_path_efficiency?: number | null;
  /** Side-to-side games: how far the hand went past the target before coming back. */
  overshoot_sw?: number | null;
  /** Side-to-side games: towards the outside or across the body. */
  side?: "out" | "across" | null;
  /** Hand-opening games: spawn to the start of the hold that succeeded, in ms. */
  time_to_open_ms?: number | null;
  /** Hand-opening games: the highest openness, 0–1. */
  peak_openness?: number | null;
  /** Hand-opening games: standard deviation of openness during the successful hold, 0–1. */
  hold_stability?: number | null;
  /** Hand-opening games: closing phase start to the start of the grip hold that succeeded, in ms. */
  time_to_close_ms?: number | null;
  /** Hand-opening games: the highest grip in the closing phase, 0–1. */
  peak_grip?: number | null;
  /** Hand-opening games: how fast the hand opened, in level per second. */
  openness_rise_rate?: number | null;
  /** Two-phase games: which phase ran out of time; null for a success. */
  failed_phase?: "open" | "close" | "hold" | "relax" | null;
  /** Sequence games: notes in the melody. */
  notes_total?: number | null;
  /** Sequence games: notes played with the right finger in time. */
  hits?: number | null;
  /** Sequence games: notes not played, with only wrong fingers touched. */
  wrong_finger?: number | null;
  /** Sequence games: notes with no touch at all. */
  missed?: number | null;
  /** Sequence games: hits over notes, 0–1. */
  hit_rate?: number | null;
  /** Sequence games: mean absolute touch time minus arrival over the hits, in ms. */
  mean_timing_error_ms?: number | null;
  /** Sequence games: hits and notes asked, for each finger used. */
  per_finger?: Partial<Record<FingerName, { hits: number; attempts: number }>> | null;
  /** Tracing games: mean distance from the moving guide, in SW. */
  mean_tracking_error_sw?: number | null;
  /** Tracing games: mean distance from the path, in SW. */
  mean_path_error_sw?: number | null;
  /** Tracing games: share of the trace inside the corridor, 0–100. */
  time_in_corridor_pct?: number | null;
  /** Tracing games: mean delay behind the guide, in ms (negative when ahead). */
  lag_ms?: number | null;
  /** Tracing games: share of the path followed inside the corridor, 0–100. */
  coverage_pct?: number | null;
  /** Smoothness (SPARC) of the fingertip's speed: ≤ 0, closer to 0 is smoother. */
  sparc?: number | null;
  /** Elbow games: most straight minus most bent angle reached, in degrees. */
  achieved_range_deg?: number | null;
  /** Elbow games: the most bent elbow angle reached (the smallest), in degrees. */
  max_bend_deg?: number | null;
  /** Elbow games: the most straight elbow angle reached (the largest), in degrees. */
  max_straight_deg?: number | null;
  /** Elbow games: sweeps that reached the target, and those that did not. */
  full_sweeps?: number | null;
  partial_sweeps?: number | null;
  /** Elbow games: mean duration of the full sweeps, in ms. */
  mean_sweep_ms?: number | null;
  /** Smoothness (SPARC) of the elbow's angular speed: ≤ 0, closer to 0 is smoother. */
  angular_sparc?: number | null;
  /** Elbow games: the most the upper arm moved from its start during a sweep, in degrees. */
  upper_arm_motion_deg?: number | null;
  /** Carrying games: spawn to the hand first reaching the object, in ms. */
  reach_ms?: number | null;
  /** Carrying games: object first reached to the first grasp, in ms. */
  grasp_latency_ms?: number | null;
  /** Carrying games: the last grasp to the release in the box, in ms. */
  transport_ms?: number | null;
  /** Carrying games: straight distance over path length of the carry that succeeded, 0–1. */
  transport_path_efficiency?: number | null;
  /** Carrying games: times the object was let go outside the box. */
  drops?: number | null;
  /** Carrying games: distance from the box's centre at the release, in SW. */
  release_error_sw?: number | null;
  /** Holding games: spawn to the level first entering the band, in ms. */
  time_to_band_ms?: number | null;
  /** Holding games: share of the holding phase spent inside the band, 0–100. */
  time_in_band_pct?: number | null;
  /** Holding games: the longest stretch inside the band without leaving it, in ms. */
  longest_continuous_hold_ms?: number | null;
  /** Holding games: times the level went above the band, and the most it went above, 0–1. */
  overshoot_count?: number | null;
  max_overshoot?: number | null;
  /** Holding games: standard deviation of the level while inside the band, 0–1. */
  steadiness?: number | null;
  /** Holding games: the relax prompt to the level first falling below the relax level, in ms. */
  relaxation_ms?: number | null;
  /** Where the level came from in this trial. */
  input_source?: InputSource | null;
}

export type FingerName = "index" | "middle" | "ring" | "little";

export interface TrialCompensation {
  flagged: boolean;
  type: string | null;
  max_values: Record<string, number>;
}

export interface TrialCreate {
  trial_no: number;
  params: Record<string, number>;
  target: TrialTarget | null;
  outcome: TrialOutcome;
  timings: TrialTimings;
  metrics: TrialMetrics;
  compensation: TrialCompensation;
  trajectory: TrajectoryPoint[];
  /** The muscle sensor's part of the trial, when it drove the game: %MVC only, never raw data. */
  emg?: TrialEmg | null;
}

/** One trial's muscle-sensor measures (%MVC, ms or shares). */
export interface TrialEmgMetrics {
  peak_mvc: number | null;
  mean_mvc_active: number | null;
  onset_latency_ms: number | null;
  relaxation_ms: number | null;
  onset_ms: number | null;
  offset_ms: number | null;
  time_in_band_pct: number | null;
  steadiness: number | null;
}

export interface TrialEmg {
  site: EmgSite;
  /** [ms since spawn, %MVC] at 50 Hz, at most 1500 points. */
  trace: [number, number][];
  metrics: TrialEmgMetrics;
}

export interface GameSummary {
  successes: number;
  success_rate: number;
  mean_movement_ms: number | null;
  mean_path_efficiency: number | null;
  compensated_trials: number;
  /** Figures only one game has, such as the highest balloon popped. */
  details?: Record<string, number | string | boolean | null>;
}

export interface GameRunEnd {
  status: "completed" | "aborted";
  score: number;
  summary: GameSummary | null;
}

export interface GameRun {
  id: number;
  session_id: number;
  game_id: GameId;
  engine: GameEngine;
  input_source: InputSource;
  params_initial: Record<string, number>;
  started_at: string;
  ended_at: string | null;
  status: GameRunStatus;
  trials_planned: number;
  trials_done: number;
  score: number | null;
  summary: GameSummary | null;
}

export interface LastSessionGame {
  game_id: GameId;
  score: number | null;
  success_rate: number | null;
}

/** How usable a trial's RAW data was, from the server's recomputation. */
export interface TrialDataQuality {
  engine_version: number;
  n_points: number;
  sampling_hz: number | null;
  gaps_over_200ms: number;
  max_gap_ms: number | null;
  /** "trajectory": recomputed from the RAW points; "client": the browser's figures, checked. */
  source: "trajectory" | "client";
  client_metrics_valid?: boolean;
  /** Measures where the server's value differs from the browser's by more than 10%. */
  mismatches: Record<string, { client: number; server: number }>;
}

export interface TrialRead extends TrialCreate {
  id: number;
  game_run_id: number;
  created_at: string;
  /** The server's own measures; null until the run ends or an admin recomputes. */
  metrics_server?: Record<string, number | string | null> | null;
  data_quality?: TrialDataQuality | null;
}

export interface GameRunDetail extends GameRun {
  trials: TrialRead[];
  /** The difficulty engine's decisions, in trial order (admin only). */
  adaptation?: AdaptationLogRow[];
}

/** The difficulty engine's state: one difficulty (0–1) per component, and its bookkeeping. */
export interface EngineStateJson {
  d?: Record<string, number>;
  streak?: number;
  turn?: number;
}

/** One decision of the difficulty engine and its safety layer. */
export interface AdaptationLogRow {
  /** The trial the decision came after; 0 is the start of the run. */
  trial_no: number;
  engine: string;
  state_before: EngineStateJson;
  state_after: EngineStateJson;
  params: Record<string, number>;
  decision: string;
  safety_override: string | null;
  cue: EngineCue | null;
  trial: EngineLastTrial | null;
  /** L2's sampled values, choices and target; null for L0 and L1. */
  details?: AdaptationDetails | null;
  /** 1–10, after the decision. */
  level: number;
  created_at: string;
}

/** What L2 logs with each decision. */
export interface AdaptationDetails {
  target?: {
    direction_deg: number | null;
    side: "out" | "across" | null;
    distance_frac: number;
    sector: string;
  };
  sector_samples?: Record<string, number>;
  chosen_sector?: string;
  levels?: Record<string, number>;
}

/** L2's beliefs, kept in the engine state's `extra`. */
export interface L2Extra {
  sectors?: Record<string, [number, number]>;
  seen?: Record<string, number>;
}

/** The session planner's plan (GET /api/sessions/{id}/plan). */
export interface PlannedGame {
  game_id: GameId;
  trials: number;
  minutes: number;
  reason_key: string;
  reason_params: Record<string, string | number>;
}

export interface SessionPlan {
  games: PlannedGame[];
  total_minutes: number;
  focus: { movements: string[]; directions: number[] };
  notes: { key: string; params: Record<string, string> }[];
  version: number;
  created_at: string | null;
}

export interface PlanOverride {
  at: string;
  planned: GameId[];
  games: GameId[];
  removed: GameId[];
  added: GameId[];
  reordered: boolean;
}

export interface LatestPlan {
  session_id: number | null;
  started_at: string | null;
  session_status: string | null;
  plan: SessionPlan | null;
  overrides: PlanOverride[];
}

/** The planner's plan for the next session, in the session facts. */
export interface FactsNextSession {
  focus_movements: string[];
  focus_directions: number[];
  planned_games: GameId[];
}

/** A patient's current difficulty in one game, for the admin. */
export interface GameLevel {
  game_id: GameId;
  engine: string;
  level: number;
  d: Record<string, number>;
  trials_seen: number;
  updated_at: string;
}

export interface PatientLevels {
  engine_mode: EngineMode;
  games: GameLevel[];
}

/** Everything recorded in one session, for the admin session page. */
export interface AdminSessionDetail extends SessionRecord {
  patient_code: string;
  patient_name: string;
  duration_seconds: number | null;
  calibration: Calibration | null;
  warmup_results: WarmupResult[];
  games: GameRunDetail[];
  /** The cool-down questionnaire, or null if it was not submitted. */
  feedback: SessionFeedback | null;
  flags: SafetyFlag[];
  needs_review: boolean;
  reviewed_at: string | null;
  review_note: string | null;
  /** The session's catalogue measures, by metric id then game; empty until computed. */
  session_metrics?: SessionMetricRow[];
  /** The muscle sensor's calibration, when the session used the sensor. */
  emg_calibration?: EmgCalibrationRead | null;
}

export interface AdminRecentSession {
  id: number;
  patient_id: number;
  patient_code: string;
  patient_name: string;
  started_at: string;
  status: SessionStatus;
  duration_seconds: number | null;
  games: LastSessionGame[];
}

export type Difficulty = "too_easy" | "just_right" | "too_hard";
export type SafetyFlag = "pain" | "new_symptoms" | "high_fatigue";

/** The cool-down questionnaire as sent. The LLM feedback module reads these field names. */
export interface SessionFeedbackCreate {
  pain_0_10: number;
  fatigue_0_10: number;
  enjoyment_1_5: number;
  difficulty: Difficulty;
  new_symptoms: boolean;
  comment: string | null;
}

/** The saved questionnaire, with the safety flags it raised. */
export interface SessionFeedback extends SessionFeedbackCreate {
  id: number;
  session_id: number;
  created_at: string;
  flags: SafetyFlag[];
  needs_review: boolean;
}

/** A session whose questionnaire raised a safety flag. */
export interface AdminAlert {
  session_id: number;
  patient_id: number;
  patient_code: string;
  date: string;
  flags: SafetyFlag[];
  reviewed: boolean;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface CalendarDay {
  /** The patient's local date, YYYY-MM-DD. */
  date: string;
  completed: number;
}

/** One completed session, for the trend charts. */
export interface ProgressPoint {
  session_id: number;
  date: string;
  hull_area_sw2: number | null;
  warmup_goals_reached: number;
  warmup_total: number;
  /** Successful trials over all trials of every game, leaving out stopped trials. */
  game_success_rate: number | null;
  total_reps: number;
  /** Bloom: the average of each turn's peak openness, 0–1; null without Bloom. */
  bloom_peak_openness?: number | null;
  /** Finger piano: notes played over notes asked, 0–1; null without Finger piano. */
  piano_hit_rate?: number | null;
  /** Path trace: the mean SPARC of its traces (≤ 0; closer to 0 is smoother). */
  path_sparc?: number | null;
  /** Paint the wall: the mean elbow range reached per stripe, in degrees. */
  elbow_range_deg?: number | null;
  /** Pick and place: the mean carry time of the objects placed, in ms. */
  pick_transport_ms?: number | null;
  /** Grip and hold: the mean steadiness (standard deviation of the level, 0–1; smaller is steadier). */
  grip_steadiness?: number | null;
  /** Grip and hold: the mean time to relax after the holds, in ms. */
  grip_relaxation_ms?: number | null;
}

export interface ReachSnapshot {
  session_id: number;
  date: string;
  reach_radii_sw: number[];
  hull_sw: PointPair[];
  hull_area_sw2: number;
  valid: boolean[];
}

export interface PatientProgress {
  streak_days: number;
  sessions_this_week: number;
  weekly_goal: number;
  /** The last 28 local days, oldest first, ending today. */
  calendar: CalendarDay[];
  /** Completed sessions, oldest first. */
  series: ProgressPoint[];
  last_session_date: string | null;
  first_reach: ReachSnapshot | null;
  latest_reach: ReachSnapshot | null;
}

/** The patient's last finished run of the same game in an earlier session. */
export interface GameComparison {
  session_id: number;
  score: number | null;
  success_rate: number | null;
  summary: GameSummary | null;
}

export interface SessionReportGame {
  run_id: number;
  game_id: GameId;
  status: GameRunStatus;
  score: number | null;
  trials_done: number;
  trials_planned: number;
  successes: number | null;
  success_rate: number | null;
  summary: GameSummary | null;
  /** The game's headline figure, the same one mainMeasure() words. */
  main_measure?: GameMeasure | null;
  /** More figures beside the headline, the same ones extraMeasures() words. */
  extra_measures?: GameMeasure[];
  previous: GameComparison | null;
  /** The level (1–10) the game started and ended at; null without adaptive settings. */
  level_start?: number | null;
  level_end?: number | null;
}

/** One figure of a game run, named so the app can word it. */
export interface GameMeasure {
  name: string;
  value: number | string | null;
  unit: "ms" | "share" | "percent" | "count" | "deg" | "sparc" | "finger";
}

/** Everything the end-of-session summary shows, with figures from earlier sessions. */
export interface SessionReport {
  session_id: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  duration_seconds: number | null;
  /** Warm-up exercise time plus the time of each finished game. */
  active_seconds: number;
  warmup: WarmupSummary | null;
  previous_warmup: (WarmupSummary & { session_id: number }) | null;
  games: SessionReportGame[];
  reach: ReachSnapshot | null;
  previous_reach: ReachSnapshot | null;
  feedback: SessionFeedback | null;
  flags: SafetyFlag[];
}

/** One adjustable setting of a game, as exported to shared/game-specs.json. */
export interface GameParamSpec {
  name: string;
  label_key: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
  harder: "higher" | "lower" | null;
  /** Which kind of difficulty the engine treats it as; "fixed" is never adapted. */
  component: "spatial" | "activation" | "speed" | "precision" | "fixed";
}

export interface GameSpec {
  id: GameId;
  name_key: string;
  description_key: string;
  movement_key: string;
  implemented: boolean;
  trials_default: number;
  estimated_minutes: number;
  params: GameParamSpec[];
}

/** A game's spec with the admin's setting, and the defaults and trials patients get. */
export interface AdminGameSetting {
  spec: GameSpec;
  enabled: boolean;
  /** Only the settings the admin changed. */
  default_params: Record<string, number>;
  /** Null: the game's own number of trials. */
  trials_default: number | null;
  notes: string | null;
  /** Null until the admin first saves a setting for the game. */
  updated_at: string | null;
  effective_params: Record<string, number>;
  effective_trials: number;
}

export interface GameSettingUpdate {
  enabled: boolean;
  default_params: Record<string, number>;
  /** 5 to 40, or null for the game's own number. */
  trials_default: number | null;
  notes: string | null;
}

/** A game a patient may play, with the defaults and trials to start from. */
export interface PatientGameSetting {
  game_id: GameId;
  params: Record<string, number>;
  trials: number;
}

// Catalogue measures (shared/metrics-catalog.json)

export type MetricBetterWhen = "higher" | "lower" | "closer_to_zero";
export type MetricStatus = "improved" | "worse" | "no_detectable_change" | "no_baseline";

/** One stored catalogue measure of a session. */
export interface SessionMetricRow {
  metric_id: string;
  /** The game a trial measure comes from; null for session measures. */
  game_id: GameId | null;
  value: number;
  unit: string;
  /** How many items (trials, warm-up results, answers) the value comes from. */
  n: number;
  details: Record<string, unknown> | null;
  computed_at: string;
}

export interface MetricPoint {
  session_id: number;
  date: string;
  value: number;
}

/** One measure over the patient's completed sessions, oldest first; per game for trial measures. */
export interface MetricSeries {
  metric_id: string;
  game_id: GameId | null;
  name: string;
  unit: string;
  better_when: MetricBetterWhen;
  points: MetricPoint[];
}

/** A measure's latest value against the patient's baseline (the first two sessions). */
export interface MetricChange {
  metric_id: string;
  game_id: GameId | null;
  name: string;
  unit: string;
  better_when: MetricBetterWhen;
  baseline: number | null;
  latest: number | null;
  /** latest − baseline, in the measure's unit. */
  change: number | null;
  /** The change in MDC units, positive when better. */
  change_mdc: number | null;
  status: MetricStatus;
  mdc: number | null;
  /** True while the MDC is a placeholder. */
  provisional: boolean;
  n_sessions: number;
}

export interface PatientMetrics {
  metrics: MetricChange[];
  series: MetricSeries[];
  mdc_provisional: boolean;
}

// Feedback reports (server/app/api/feedback.py). Model text is always shown as plain text.

export type ReportStatus = "queued" | "running" | "done" | "fallback" | "failed";
export type Rater = "participant" | "team" | "clinician";
export type RatingCriterion =
  "clarity" | "usefulness" | "accuracy" | "tone" | "safety" | "helpfulness";

export interface FeedbackHighlight {
  metric_id: string;
  text: string;
}

export interface FeedbackSuggestion {
  /** A suggestion id from the catalogue, such as "REST_BREAKS". */
  id: string;
  text: string;
}

export interface FeedbackReport {
  language: Language;
  patient_summary: string;
  highlights: FeedbackHighlight[];
  suggestions: FeedbackSuggestion[];
  next_session_text: string;
  /** Admins only. */
  therapist_summary?: string;
}

export interface FeedbackJob {
  job_id: number;
  status: ReportStatus;
}

export interface FeedbackMeta {
  model: string | null;
  prompt_version: string | null;
  latency_ms: number | null;
  retries: number;
  fallback_used: boolean;
}

/** A report, or the state of its job: report, notices and meta once done or fallback. */
export interface FeedbackReportRead {
  job_id: number;
  session_id: number;
  language: Language;
  status: ReportStatus;
  report: FeedbackReport | null;
  /** Fixed, approved safety notices: show them first. */
  safety_notices: string[] | null;
  meta: FeedbackMeta | null;
  created_at: string;
  finished_at: string | null;
}

export interface PatientReportItem {
  job_id: number;
  session_id: number;
  session_no: number;
  date: string;
  language: Language;
  status: ReportStatus;
  preview: string;
  has_safety_notice: boolean;
}

export interface AdminReportItem {
  job_id: number;
  session_id: number;
  patient_id: number;
  patient_code: string;
  language: Language;
  status: ReportStatus;
  superseded: boolean;
  model: string | null;
  prompt_version: string | null;
  latency_ms: number | null;
  retries: number;
  fallback_used: boolean;
  error: string | null;
  validation_errors: string[][];
  ratings: number;
  created_at: string;
  finished_at: string | null;
}

export interface AdminReportDetail extends FeedbackReportRead {
  superseded: boolean;
  facts: Record<string, unknown> | null;
  candidates: Record<string, unknown>[] | null;
  validation_errors: string[][];
  raw_output: string | null;
  error: string | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
}

export interface RatingCreate {
  rater: Rater;
  scores: Partial<Record<RatingCriterion, number>>;
  comment?: string | null;
}

export interface RatingRead {
  id: number;
  report_id: number;
  rater: Rater;
  rater_user_id: number;
  scores: Partial<Record<RatingCriterion, number>>;
  comment: string | null;
  /** Blind review ratings only. */
  review_set_id?: number | null;
  unsafe?: boolean | null;
  unsupported_text?: string | null;
  created_at: string;
}

export interface FeedbackHealth {
  provider: string;
  model: string;
  reachable: boolean;
  model_loaded: boolean;
  queue_length: number;
}

// Blind review of the feedback (server/app/api/review.py)

export type ReviewDimension = "accuracy" | "safety" | "helpfulness" | "clarity" | "tone";
export type ReviewRater = "team" | "clinician";

export interface ReviewSetRead {
  id: number;
  name: string;
  language: Language;
  sessions: number;
  items: number;
  ready_items: number;
  status: "building" | "ready";
  my_ratings: number;
  created_at: string;
}

export interface ReviewSetCreate {
  size: number;
  language: Language;
  name?: string | null;
}

export interface BlindItemSummary {
  code: string;
  position: number;
  rated_by_me: boolean;
}

/** The session's facts as the rater sees them (the session facts without the ids). */
export interface ReviewFacts {
  session_no?: number;
  duration_min?: number | null;
  baseline_available?: boolean;
  games?: Record<
    string,
    {
      trials: number;
      success_rate: number | null;
      level_start?: number | null;
      level_end?: number | null;
    }
  >;
  metrics?: {
    id: string;
    game_id: string | null;
    name: string;
    value: number;
    baseline: number | null;
    unit: string;
    change_mdc: number | null;
    mdc_status: MetricStatus;
  }[];
  directions?: { weak: number[]; strong: number[] };
  flags?: {
    compensation_rate: number | null;
    fatigue_flag: boolean;
    hand_loss_pct: number | null;
    shoulder_compensation_rate?: number | null;
    safety_flags?: string[];
  };
  self_report?: { pain_0_10: number; fatigue_0_10: number; enjoyment_1_5: number } | null;
  adherence?: { sessions_this_week: number; planned_this_week: number };
  next_session?: {
    focus_movements: string[];
    focus_directions: number[];
    planned_games: string[];
  } | null;
  safety_notice_present?: boolean;
}

export interface BlindItem {
  code: string;
  position: number;
  total: number;
  facts: ReviewFacts;
  safety_notices: string[];
  report: FeedbackReport | null;
  my_rating: RatingRead | null;
}

export interface ReviewRatingCreate {
  rater: ReviewRater;
  scores: Record<ReviewDimension, number>;
  unsafe: boolean;
  unsupported?: string | null;
  comment?: string | null;
}

export interface ReviewVersionSummary {
  items: number;
  ratings: number;
  means: Partial<Record<ReviewDimension, number | null>>;
  sds: Partial<Record<ReviewDimension, number | null>>;
  unsafe_pct: number | null;
}

export interface ReviewResults {
  review_set_id: number;
  status: "building" | "ready";
  items: number;
  llm_fallbacks: number;
  versions: Record<"llm" | "template" | "llm_model_written", ReviewVersionSummary>;
  raters: { user_id: number; rater: string; ratings: number }[];
  agreement: {
    dimension: ReviewDimension | "unsafe";
    rater_a: number;
    rater_b: number;
    items: number;
    kappa: number | null;
  }[];
}

// The muscle sensor's calibration (server/app/schemas/emg.py)

export interface EmgCalibrationCreate {
  site: EmgSite;
  source: "serial" | "simulated";
  firmware_version: string | null;
  sample_rate: number;
  rest_mean_mv: number;
  rest_sd_mv: number;
  mvc_mv: number;
  mvc_attempts: number[];
  readiness: Record<string, unknown>;
  quality: Record<string, unknown>;
  battery_ok: boolean;
  gain_note?: string | null;
}

export interface EmgCalibrationRead extends EmgCalibrationCreate {
  id: number;
  session_id: number;
  threshold_mv: number;
  gain_note: string | null;
  created_at: string;
}

// Each patient's programme (server/app/schemas/programme.py)

export type ProgrammeWarmupPreset = "personal" | "gentle";

/** Every setting of a programme, as the admin sees and sends it. */
export interface ProgrammeFields {
  enabled_games: GameId[];
  /** The highest level (1-10) per game; a game left out may reach 10. */
  max_level: Partial<Record<GameId, number>>;
  session_minutes_target: number;
  games_per_session: { min: number; max: number };
  /** Warm-up exercise ids (see warmup/exercises.ts). */
  warmup_exercises: string[];
  warmup_preset: ProgrammeWarmupPreset;
  rest_every_minutes: number;
  engine_mode: EngineMode;
  emg_default_site: EmgSite | null;
  weekly_goal: number;
  notes: string | null;
}

export interface ProgrammeUpdate extends ProgrammeFields {
  reason?: string | null;
}

export interface Programme extends ProgrammeFields {
  patient_id: number;
  /** Games the Game Library has turned off: never played, whatever the programme says. */
  library_disabled_games: GameId[];
  updated_at: string;
}

export interface ProgrammeChange {
  id: number;
  field: keyof ProgrammeFields | string;
  before: unknown;
  after: unknown;
  reason: string | null;
  admin_id: number | null;
  admin_name: string | null;
  created_at: string;
}

/** The patient's read-only view: what the browser obeys. */
export interface PatientProgramme {
  enabled_games: GameId[];
  warmup_exercises: string[];
  warmup_preset: ProgrammeWarmupPreset;
  rest_every_minutes: number;
  emg_default_site: EmgSite | null;
  weekly_goal: number;
}
