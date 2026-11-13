import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";
import { onVoicesChanged, stopSpeaking } from "@/lib/speech";
import type { Language } from "@/types/api";

import { hasVoice, speakText } from "./readAloud";

/** Reads the report aloud in its language, with Stop while speaking. Hidden when the browser
 * has no voice for the language (Bangla voices depend on the device). */
export function ReadAloudButton({ text, language }: { text: string; language: Language }) {
  const [available, setAvailable] = useState(() => hasVoice(language));
  const [speaking, setSpeaking] = useState(false);

  // Browsers load their voices late.
  useEffect(() => onVoicesChanged(() => setAvailable(hasVoice(language))), [language]);
  // Leaving the page stops the reading.
  useEffect(() => () => stopSpeaking(), []);

  if (!available) return null;
  if (speaking) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          stopSpeaking();
          setSpeaking(false);
        }}
      >
        <Square size={20} aria-hidden />
        {t("feedback.stopReading")}
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      onClick={() => {
        setSpeaking(true);
        speakText(text, language, () => setSpeaking(false));
      }}
    >
      <Volume2 size={20} aria-hidden />
      {t("feedback.readAloud")}
    </Button>
  );
}
