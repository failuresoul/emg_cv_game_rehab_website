import { describe, expect, it } from "vitest";

import {
  COMMENT_MAX,
  EMPTY_DRAFT,
  painFace,
  type QuestionnaireDraft,
  SCALE_0_10,
  shouldShowStopNotice,
  STARS_1_5,
  toPayload,
  unanswered,
} from "./questionnaire";

const COMPLETE: QuestionnaireDraft = {
  pain: 2,
  fatigue: 5,
  enjoyment: 4,
  difficulty: "just_right",
  newSymptoms: false,
  comment: "",
};

describe("scales", () => {
  it("run from 0 to 10 and 1 to 5", () => {
    expect(SCALE_0_10).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(STARS_1_5).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("unanswered", () => {
  it("lists every question of an empty draft in order", () => {
    expect(unanswered(EMPTY_DRAFT)).toEqual([
      "pain",
      "fatigue",
      "enjoyment",
      "difficulty",
      "newSymptoms",
    ]);
  });

  it("counts 0 and false as answers", () => {
    expect(unanswered({ ...COMPLETE, pain: 0, newSymptoms: false })).toEqual([]);
  });

  it("does not need a comment", () => {
    expect(unanswered({ ...COMPLETE, comment: "" })).toEqual([]);
  });
});

describe("toPayload", () => {
  it("is null while a question is unanswered", () => {
    expect(toPayload(EMPTY_DRAFT)).toBeNull();
    expect(toPayload({ ...COMPLETE, difficulty: null })).toBeNull();
    expect(toPayload({ ...COMPLETE, newSymptoms: null })).toBeNull();
  });

  it("uses the API field names", () => {
    expect(toPayload({ ...COMPLETE, newSymptoms: true, comment: "Felt fine" })).toEqual({
      pain_0_10: 2,
      fatigue_0_10: 5,
      enjoyment_1_5: 4,
      difficulty: "just_right",
      new_symptoms: true,
      comment: "Felt fine",
    });
  });

  it("sends a blank comment as null and trims the rest", () => {
    expect(toPayload({ ...COMPLETE, comment: "   " })?.comment).toBeNull();
    expect(toPayload({ ...COMPLETE, comment: "  ok  " })?.comment).toBe("ok");
  });

  it("cuts a comment to the limit", () => {
    const comment = toPayload({ ...COMPLETE, comment: "x".repeat(COMMENT_MAX + 20) })?.comment;
    expect(comment).toHaveLength(COMMENT_MAX);
  });
});

describe("shouldShowStopNotice", () => {
  it("shows for pain or new symptoms", () => {
    expect(shouldShowStopNotice(["pain"])).toBe(true);
    expect(shouldShowStopNotice(["new_symptoms"])).toBe(true);
    expect(shouldShowStopNotice(["high_fatigue", "pain"])).toBe(true);
  });

  it("does not show for tiredness alone or no flags", () => {
    expect(shouldShowStopNotice(["high_fatigue"])).toBe(false);
    expect(shouldShowStopNotice([])).toBe(false);
  });
});

describe("painFace", () => {
  it("spreads five faces across the scale", () => {
    expect(SCALE_0_10.map(painFace)).toEqual([
      "laugh",
      "laugh",
      "smile",
      "smile",
      "meh",
      "meh",
      "frown",
      "frown",
      "annoyed",
      "annoyed",
      "annoyed",
    ]);
  });
});
