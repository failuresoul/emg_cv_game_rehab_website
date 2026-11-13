import { t } from "@/i18n";
import { SPEECH_LANGUAGES, voicesFor } from "@/lib/speech";
import type { FeedbackReport, Language } from "@/types/api";

/** True when the browser has a voice for the language (en-US or bn-BD). */
export function hasVoice(language: Language): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  return voicesFor(language).length > 0;
}

/** The best voice: one for exactly en-US or bn-BD, else any of the language. */
export function pickVoice(language: Language): SpeechSynthesisVoice | null {
  const voices = voicesFor(language);
  const exact = SPEECH_LANGUAGES[language].toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase().replace("_", "-") === exact) ??
    voices[0] ??
    null
  );
}

/** What is read: the safety notices first, then the report, in the order shown. */
export function speechText(report: FeedbackReport, notices: readonly string[]): string {
  return [
    ...notices,
    report.patient_summary,
    ...report.highlights.map((item) => item.text),
    ...report.suggestions.map((item) => item.text),
    `${t("feedback.nextTime")} ${report.next_session_text}`,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/** Reads the text aloud, replacing anything being read; `onEnd` runs when it stops. Feedback
 * is read even when game sounds are muted: the patient asked for it. */
export function speakText(text: string, language: Language, onEnd: () => void): void {
  if (!hasVoice(language)) {
    onEnd();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANGUAGES[language];
  const voice = pickVoice(language);
  if (voice) utterance.voice = voice;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
