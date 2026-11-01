import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { PatientDashboard } from "@/types/api";

export function usePatientDashboard() {
  return useQuery({
    queryKey: ["patient", "dashboard"],
    queryFn: async () => (await api.get<PatientDashboard>("/patient/dashboard")).data,
  });
}
