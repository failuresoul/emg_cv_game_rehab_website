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
  created_at: string;
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

export type PatientUpdate = Partial<PatientCreate>;

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
}

export type SessionStep =
  "setup" | "calibrate" | "warmup" | "plan" | "game" | "cooldown" | "summary";

/** Today's games in order and the one being played; index equals games.length once done. */
export interface GameQueueState {
  games: GameId[];
  index: number;
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

export interface TrialTarget {
  x_sw: number;
  y_sw: number;
  radius_sw: number;
  direction_deg: number;
  distance_frac: number;
  /** Direction and ring, for example "D3R2". */
  sector: string;
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
}

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

export interface TrialRead extends TrialCreate {
  id: number;
  game_run_id: number;
  created_at: string;
}

export interface GameRunDetail extends GameRun {
  trials: TrialRead[];
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
  previous: GameComparison | null;
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
