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

export interface SessionRecord {
  id: number;
  patient_id: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  device_info: DeviceInfo | null;
  notes: string | null;
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

export interface LastSession {
  date: string;
  status: SessionStatus;
  duration_seconds: number | null;
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
  streak_days: number;
}
