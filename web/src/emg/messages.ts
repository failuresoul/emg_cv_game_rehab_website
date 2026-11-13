import type { TranslationKey } from "@/i18n";

import type { EmgErrorCode } from "./stream";

/** What to tell the person when the muscle sensor cannot connect, or stops. */
export const EMG_ERROR_KEYS: Record<EmgErrorCode, TranslationKey> = {
  not_supported: "emg.error.notSupported",
  no_port: "emg.error.noPort",
  open_failed: "emg.error.openFailed",
  lost: "emg.error.lost",
  write_failed: "emg.error.lost",
};
