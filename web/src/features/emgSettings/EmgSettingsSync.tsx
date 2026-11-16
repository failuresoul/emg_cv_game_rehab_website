import { useOptionalAuth } from "@/features/auth/AuthContext";

import { useEmgSettings } from "./emgSettingsApi";

/** Loads the admin's EMG thresholds once someone is signed in (the defaults apply until then). */
export function EmgSettingsSync() {
  const auth = useOptionalAuth();
  useEmgSettings(Boolean(auth?.user));
  return null;
}
