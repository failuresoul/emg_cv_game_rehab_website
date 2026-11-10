import { closeAudio } from "@/lib/beep";
import { stopSpeaking } from "@/lib/speech";
import { visionEngine } from "@/vision/visionEngine";

import { sessionStops } from "./sessionStop";

/**
 * Stops every game loop, the camera, speech and sound, whoever started them. Called on every way
 * out of a session. Returns how many game loops and other registered tasks were stopped.
 */
export function stopSession(): number {
  const stopped = sessionStops.stopAll();
  visionEngine.stopAll();
  stopSpeaking();
  closeAudio();
  return stopped;
}
