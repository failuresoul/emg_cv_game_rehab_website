import type { Language } from "@/types/api";

import { isMuted } from "./beep";

export const SPEECH_LANGUAGES: Record<Language, string> = { en: "en-US", bn: "bn-BD" };

export function voicesFor(language: Language): SpeechSynthesisVoice[] {
  const prefix = language === "bn" ? "bn" : "en";
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
}

/**
 * Bangla voices depend on the device, and without one a browser reads Bangla as nonsense or not at
 * all, so a voice option should only be offered when this is true.
 */
export function canSpeak(language: Language): boolean {
  if (!("speechSynthesis" in window)) return false;
  return language === "en" || voicesFor(language).length > 0;
}

/** Browsers load their voices late, so call this again when they arrive. */
export function onVoicesChanged(listener: () => void): () => void {
  if (!("speechSynthesis" in window)) return () => undefined;
  window.speechSynthesis.addEventListener("voiceschanged", listener);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", listener);
}

/** Reads text aloud, replacing anything still being read. */
export function speak(text: string, language: Language): void {
  if (!canSpeak(language) || isMuted()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANGUAGES[language];
  const [voice] = voicesFor(language);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
