import { useQuery } from "@tanstack/react-query";

import { PATIENT_KEY } from "@/features/patient/usePatientData";
import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import type { EmgSite, PatientProgramme } from "@/types/api";
import type { ThresholdPreset } from "@/warmup/exercises";

export const PATIENT_PROGRAMME_KEY = [...PATIENT_KEY, "programme"] as const;

/** The patient's programme, read-only: the therapist changes it. When it cannot be read, the
 * session carries on with every exercise and the usual targets (it never blocks a session). */
export function usePatientProgramme() {
  return useQuery({
    queryKey: PATIENT_PROGRAMME_KEY,
    queryFn: async () => (await api.get<PatientProgramme>("/patient/programme")).data,
    meta: SILENT,
    staleTime: 60_000,
  });
}

/** The warm-up's exercises for this patient, in the warm-up's own order: those the programme
 * turns on, or every one without a programme. */
export function warmupOrder<Id extends string>(
  order: readonly Id[],
  programme: Pick<PatientProgramme, "warmup_exercises"> | null | undefined,
): Id[] {
  if (!programme) return [...order];
  const allowed = new Set(programme.warmup_exercises);
  const chosen = order.filter((id) => allowed.has(id));
  return chosen.length > 0 ? chosen : [...order];
}

/** The preset the programme forces ("gentle"), or null when the patient's usual targets apply. */
export function forcedWarmupPreset(
  programme: Pick<PatientProgramme, "warmup_preset"> | null | undefined,
): ThresholdPreset | null {
  return programme?.warmup_preset === "gentle" ? "gentle" : null;
}

/** The muscle-sensor site the EMG step suggests, or null. */
export function defaultEmgSite(
  programme: Pick<PatientProgramme, "emg_default_site"> | null | undefined,
): EmgSite | null {
  return programme?.emg_default_site ?? null;
}
