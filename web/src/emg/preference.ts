/** "Use the muscle sensor today", remembered per patient in this browser. */

const key = (patientId: number) => `muvi-emg-use-${patientId}`;

export function readEmgPreference(patientId: number | null | undefined): boolean {
  if (patientId == null) return false;
  try {
    return localStorage.getItem(key(patientId)) === "on";
  } catch {
    return false;
  }
}

export function writeEmgPreference(patientId: number | null | undefined, on: boolean): void {
  if (patientId == null) return;
  try {
    if (on) localStorage.setItem(key(patientId), "on");
    else localStorage.removeItem(key(patientId));
  } catch {
    // Only a convenience: the toggle still works for this visit.
  }
}
