import type { TranslationKey } from "@/i18n";
import type { Difficulty, SafetyFlag, SessionFeedbackCreate } from "@/types/api";

export const RELAX_SECONDS = 60;
export const COMMENT_MAX = 300;
export const SCALE_0_10 = Array.from({ length: 11 }, (_, index) => index);
export const STARS_1_5 = [1, 2, 3, 4, 5];
export const DIFFICULTIES: readonly Difficulty[] = ["too_easy", "just_right", "too_hard"];

/** The answers so far; null means not answered yet. */
export interface QuestionnaireDraft {
  pain: number | null;
  fatigue: number | null;
  enjoyment: number | null;
  difficulty: Difficulty | null;
  newSymptoms: boolean | null;
  comment: string;
}

export type Question = "pain" | "fatigue" | "enjoyment" | "difficulty" | "newSymptoms";

export const EMPTY_DRAFT: QuestionnaireDraft = {
  pain: null,
  fatigue: null,
  enjoyment: null,
  difficulty: null,
  newSymptoms: null,
  comment: "",
};

/** The questions still to answer, in the order they are asked. The comment is optional. */
export function unanswered(draft: QuestionnaireDraft): Question[] {
  const questions: Question[] = ["pain", "fatigue", "enjoyment", "difficulty", "newSymptoms"];
  return questions.filter((question) => draft[question] === null);
}

/** The request body, or null while a question is unanswered. */
export function toPayload(draft: QuestionnaireDraft): SessionFeedbackCreate | null {
  const { pain, fatigue, enjoyment, difficulty, newSymptoms } = draft;
  if (
    pain === null ||
    fatigue === null ||
    enjoyment === null ||
    difficulty === null ||
    newSymptoms === null
  ) {
    return null;
  }
  const comment = draft.comment.trim().slice(0, COMMENT_MAX);
  return {
    pain_0_10: pain,
    fatigue_0_10: fatigue,
    enjoyment_1_5: enjoyment,
    difficulty,
    new_symptoms: newSymptoms,
    comment: comment === "" ? null : comment,
  };
}

/** Pain or something new means the patient should stop for today and tell their therapist. */
export function shouldShowStopNotice(flags: readonly SafetyFlag[]): boolean {
  return flags.includes("pain") || flags.includes("new_symptoms");
}

export type FaceLevel = "laugh" | "smile" | "meh" | "frown" | "annoyed";

/** Five faces spread across 0–10, from no pain to the most pain. */
export function painFace(value: number): FaceLevel {
  if (value <= 1) return "laugh";
  if (value <= 3) return "smile";
  if (value <= 5) return "meh";
  if (value <= 7) return "frown";
  return "annoyed";
}

export const FLAG_LABEL_KEYS: Record<SafetyFlag, TranslationKey> = {
  pain: "safety.flag.pain",
  new_symptoms: "safety.flag.newSymptoms",
  high_fatigue: "safety.flag.highFatigue",
};

export const DIFFICULTY_LABEL_KEYS: Record<Difficulty, TranslationKey> = {
  too_easy: "cooldown.difficulty.tooEasy",
  just_right: "cooldown.difficulty.justRight",
  too_hard: "cooldown.difficulty.tooHard",
};
