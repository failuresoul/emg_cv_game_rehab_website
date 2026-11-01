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

export interface PatientDashboard {
  profile: PatientProfile;
  today_plan: TodayPlanStep[];
  last_session: null;
  streak_days: number;
}
