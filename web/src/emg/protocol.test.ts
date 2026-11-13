import { describe, expect, it } from "vitest";

// The examples shared with the Python tools (analysis/tools/emg_protocol.py), through Vite.
import fixture from "../../../firmware/test-lines.txt?raw";

import { LineSplitter, MAX_PARTIAL_LINE, parseLine } from "./protocol";

/** (raw line, expected) from firmware/test-lines.txt: the raw part ends at the first " => ";
 * "\r" in it stands for a carriage return. */
function cases(): [string, unknown][] {
  return fixture
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const at = line.indexOf(" => ");
      return [line.slice(0, at).replaceAll("\\r", "\r"), JSON.parse(line.slice(at + 4))];
    });
}

describe("firmware lines", () => {
  const examples = cases();

  it("covers every kind of line", () => {
    const kinds = new Set(
      examples.map(([, expected]) => (expected as { type: string } | null)?.type ?? null),
    );
    expect(kinds).toEqual(
      new Set(["sample", "status", "pong", "ok", "error", "info", "invalid", "unknown", null]),
    );
    expect(examples.length).toBeGreaterThanOrEqual(30);
  });

  it.each(examples)("reads %j as the Python tools do", (raw, expected) => {
    expect(parseLine(raw)).toEqual(expected);
  });
});

describe("splitting the stream into lines", () => {
  it("keeps a line cut between chunks until its end arrives", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("E,1,200\nE,2,2")).toEqual(["E,1,200"]);
    expect(splitter.push("10\r\nE,3")).toEqual(["E,2,210\r"]);
    expect(splitter.push(",230\nS,3,0,1.0.0,ADC\n")).toEqual(["E,3,230", "S,3,0,1.0.0,ADC"]);
    expect(parseLine("E,2,210\r")).toEqual({ type: "sample", counter: 2, mv: 210 });
  });

  it("handles one character at a time, and many lines at once", () => {
    const splitter = new LineSplitter();
    const lines: string[] = [];
    for (const char of "PONG,1.0.0\nOK,START\n") lines.push(...splitter.push(char));
    expect(lines).toEqual(["PONG,1.0.0", "OK,START"]);
    expect(splitter.push("E,1,1\nE,2,2\nE,3,3\n")).toHaveLength(3);
  });

  it("drops a runaway partial line, and forgets on reset", () => {
    const splitter = new LineSplitter();
    splitter.push("x".repeat(MAX_PARTIAL_LINE + 1));
    expect(splitter.push("E,1,200\n")).toEqual(["E,1,200"]);
    splitter.push("E,9");
    splitter.reset();
    expect(splitter.push(",9\n")).toEqual([",9"]);
  });
});
