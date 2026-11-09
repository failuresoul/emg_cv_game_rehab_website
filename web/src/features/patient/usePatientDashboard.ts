import { useQuery } from "@tanstack/react-query";

import { tzOffsetMinutes } from "@/features/progress/progress";
import { api } from "@/lib/api";
import type { PatientDashboard } from "@/types/api";

export function usePatientDashboard() {
  return useQuery({
    queryKey: ["patient", "dashboard"],
    queryFn: async () =>
      (
        await api.get<PatientDashboard>("/patient/dashboard", {
          // The streak counts the patient's own days.
          params: { tz_offset_minutes: tzOffsetMinutes() },
        })
      ).data,
  });
}
