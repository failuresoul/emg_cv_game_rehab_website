import { isMuted } from "./beep";

export function isSpeechAvailable(): boolean {
  return "speechSynthesis" in window;
}

/** Reads text aloud in English, replacing anything still being read. */
export function speak(text: string): void {
  if (!isSpeechAvailable() || isMuted()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (isSpeechAvailable()) window.speechSynthesis.cancel();
}
