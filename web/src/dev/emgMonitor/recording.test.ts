import { describe, expect, it } from "vitest";

import {
  EMG_CSV_HEADER,
  EmgRecorder,
  phaseAt,
  PROTOCOL,
  RECORD_MS,
  recordingName,
  toCsv,
} from "./recording";

const sample = (index: number) => ({
  t: 5000 + index * 2,
  arrivalMs: 9000 + Math.floor(index / 25) * 50,
  counter: 100 + index,
  mv: 200 + (index % 3),
  envelope: 201.234567,
});

describe("the guided 30 s recording", () => {
  it("covers 30 s with rest, three cued squeezes and relaxing", () => {
    expect(PROTOCOL[0]).toMatchObject({ from: 0, phase: "rest" });
    expect(PROTOCOL.at(-1)!.to).toBe(RECORD_MS);
    for (let index = 1; index < PROTOCOL.length; index += 1) {
      expect(PROTOCOL[index]!.from).toBe(PROTOCOL[index - 1]!.to);
    }
    expect(PROTOCOL.filter((step) => step.cue).map((step) => step.phase)).toEqual([
      "mvc1",
      "mvc2",
      "mvc3",
    ]);
    expect(phaseAt(9_999).phase).toBe("rest");
    expect(phaseAt(10_000).phase).toBe("mvc1");
    expect(phaseAt(29_999).phase).toBe("relax");
  });

  it("labels every sample, marks each cue once and stops after 30 s", () => {
    const recorder = new EmgRecorder();
    for (let index = 0; index < 16_000; index += 1) recorder.push(sample(index));
    expect(recorder.done).toBe(true);
    // 500 Hz for 30 s, and one sample at the end.
    expect(recorder.rows.length).toBe(15_001);
    expect(recorder.rows[0]).toMatchObject({ t: 0, arrival: 0, phase: "rest", cue: false });
    const cues = recorder.rows.filter((row) => row.cue);
    expect(cues.map((row) => [row.t, row.phase])).toEqual([
      [10_000, "mvc1"],
      [16_000, "mvc2"],
      [22_000, "mvc3"],
    ]);
  });

  it("writes metadata, the header and rounded rows", () => {
    const recorder = new EmgRecorder(10);
    for (let index = 0; index < 10; index += 1) recorder.push(sample(index));
    const csv = toCsv(recorder.rows, { firmware: "1.0.0", note: "left arm, flexors" });
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("# firmware: 1.0.0");
    expect(lines[1]).toBe("# note: left arm  flexors");
    expect(lines[2]).toBe(EMG_CSV_HEADER);
    expect(lines[3]).toBe("0,0,100,200,201.23,rest,0");
  });

  it("names files with the date and a clean label", () => {
    const date = new Date(2026, 10, 16, 9, 5, 7);
    expect(recordingName(date)).toBe("emg-20261116-090507");
    expect(recordingName(date, " Shadik flexors #1 ")).toBe("emg-20261116-090507-Shadik-flexors-1");
  });
});
