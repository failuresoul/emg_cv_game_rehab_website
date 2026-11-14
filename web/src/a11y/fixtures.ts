/** Small, realistic API answers for the accessibility tests (pages.a11y.test.tsx). */
import type { Me } from "@/types/api";

const NOW = "2026-11-14T10:00:00Z";

const PROFILE = {
  id: 1,
  user_id: 2,
  patient_code: "P001",
  affected_side: "left",
  dominant_side: "right",
  age_band: "60-69",
  months_since_stroke: 8,
  language: "en",
  bengali_digits: false,
  notes: null,
  weekly_goal: 5,
  is_demo: false,
  engine_mode: "L1",
  research_consent_at: null,
  created_at: NOW,
} as const;

export const PATIENT_ME = {
  id: 2,
  email: "patient@example.com",
  full_name: "Test Patient",
  role: "patient",
  is_active: true,
  last_login_at: NOW,
  created_at: NOW,
  patient_profile: PROFILE,
} as unknown as Me;

export const ADMIN_ME = {
  id: 1,
  email: "admin@example.com",
  full_name: "Test Admin",
  role: "admin",
  is_active: true,
  last_login_at: NOW,
  created_at: NOW,
  patient_profile: null,
} as unknown as Me;

export const SESSION = {
  id: 7,
  patient_id: 1,
  started_at: NOW,
  ended_at: null,
  status: "active",
  device_info: null,
  notes: null,
  current_step: "plan",
  game_queue: null,
  blinded: false,
};

const calendar = Array.from({ length: 28 }, (_, index) => ({
  date: `2026-10-${String(18 + (index % 13)).padStart(2, "0")}`,
  sessions: index % 3 === 0 ? 1 : 0,
}));

const PATIENT = {
  ...PROFILE,
  user: {
    email: "patient@example.com",
    full_name: "Test Patient",
    is_active: true,
    last_login_at: NOW,
  },
};

const ALERT = {
  id: 3,
  patient_id: 1,
  patient_code: "P001",
  session_id: 7,
  type: "pain",
  severity: "high",
  status: "open",
  details: { pain_0_10: 6 },
  created_at: NOW,
  acknowledged_by: null,
  acknowledged_at: null,
  resolved_by: null,
  resolved_at: null,
  note: null,
};

/** The fixture for a GET, or undefined (the request then fails, so error states are checked). */
export function responseFor(url: string): unknown {
  const path = url.replace(/^\/api/, "").split("?")[0] ?? "";
  const table: Record<string, unknown> = {
    "/patient/dashboard": {
      profile: PROFILE,
      today_plan: [
        { step: "warmup", minutes: 5 },
        { step: "games", minutes: 15 },
      ],
      last_session: null,
      latest_calibration: null,
      last_warmup: null,
      streak_days: 2,
    },
    "/patient/progress": {
      streak_days: 2,
      sessions_this_week: 1,
      weekly_goal: 5,
      calendar,
      series: [],
      last_session_date: null,
      first_reach: null,
      latest_reach: null,
    },
    "/patient/reports": [],
    "/patient/programme": {
      enabled_games: ["reach_activate", "grip_hold", "bloom"],
      warmup_exercises: ["shoulder_flexion"],
      warmup_preset: "personal",
      rest_every_minutes: 5,
      emg_default_site: null,
      weekly_goal: 5,
    },
    "/sessions/current": SESSION,
    "/games/settings": [
      { game_id: "reach_activate", params: {}, trials: 20 },
      { game_id: "grip_hold", params: {}, trials: 10 },
      { game_id: "bloom", params: {}, trials: 10 },
    ],
    "/sessions/7/plan": {
      games: [
        {
          game_id: "reach_activate",
          trials: 20,
          minutes: 5,
          reason_key: "variety",
          reason_params: {},
        },
        {
          game_id: "grip_hold",
          trials: 10,
          minutes: 4,
          reason_key: "keep_practising",
          reason_params: { movement: "grip" },
        },
      ],
      total_minutes: 9,
      focus: { movements: [], directions: [] },
      notes: [],
      locked: false,
      version: 1,
      created_at: NOW,
    },
    "/sessions/7/summary": {
      session_id: 7,
      started_at: NOW,
      ended_at: NOW,
      status: "completed",
      duration_seconds: 1500,
      active_seconds: 1100,
      warmup: null,
      previous_warmup: null,
      games: [],
      reach: null,
      previous_reach: null,
      feedback: {
        pain_0_10: 1,
        fatigue_0_10: 3,
        enjoyment_1_5: 4,
        difficulty: "just_right",
        new_symptoms: false,
        comment: null,
        created_at: NOW,
        flags: [],
        needs_review: false,
      },
      flags: [],
    },
    "/admin/stats": {
      total_patients: 3,
      active_patients: 3,
      sessions_today: 1,
      open_alerts: 1,
      alerts: { open: 1, open_high: 1, open_medium: 0, open_low: 0, acknowledged: 0 },
    },
    "/admin/patients": [PATIENT],
    "/admin/sessions": [],
    "/admin/alerts": [ALERT],
    "/admin/patients/1": PATIENT,
    "/admin/patients/1/sessions": [],
  };
  return table[path];
}
