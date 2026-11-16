import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { applyEmgSettings, type EmgOverrides } from "@/emg/emgSettings";
import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";

export const EMG_SETTINGS_KEY = ["emg-settings"] as const;

export interface EmgSettingsRead {
  overrides: EmgOverrides;
  updated_at: string | null;
}

async function fetchEmgSettings(): Promise<EmgSettingsRead> {
  const response = await api.get<EmgSettingsRead>("/emg-settings");
  return response.data;
}

/** The admin's EMG thresholds, put in force as soon as they arrive. */
export function useEmgSettings(enabled = true) {
  return useQuery({
    queryKey: EMG_SETTINGS_KEY,
    queryFn: async () => {
      const settings = await fetchEmgSettings();
      applyEmgSettings(settings.overrides);
      return settings;
    },
    enabled,
    // Without them the defaults apply; nothing to tell the person.
    meta: SILENT,
    staleTime: 5 * 60_000,
  });
}

function useStore() {
  const client = useQueryClient();
  return (settings: EmgSettingsRead) => {
    applyEmgSettings(settings.overrides);
    client.setQueryData(EMG_SETTINGS_KEY, settings);
  };
}

export function useSaveEmgSettings() {
  const store = useStore();
  return useMutation({
    mutationFn: async (overrides: EmgOverrides) =>
      (await api.put<EmgSettingsRead>("/admin/emg-settings", { overrides })).data,
    onSuccess: store,
  });
}

export function useResetEmgSettings() {
  const store = useStore();
  return useMutation({
    mutationFn: async () => (await api.delete<EmgSettingsRead>("/admin/emg-settings")).data,
    onSuccess: store,
  });
}
