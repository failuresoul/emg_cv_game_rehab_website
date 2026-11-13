/**
 * The lines the EMG firmware (firmware/emg_stream/emg_stream.ino) prints, read with exactly the
 * rules of analysis/tools/emg_protocol.py; firmware/test-lines.txt holds the shared examples.
 *
 *   E,<counter>,<mv>                            a sample
 *   S,<counter>,<dropped>,<version>,<ADC|SIM>   status, once per second
 *   PONG,<version>                              the answer to PING
 *   OK,<what>   ERR,<why>                       answers to commands
 *   I,key=value,...                             settings (INFO, and at start-up)
 */

export const MAX_COUNTER = 4_294_967_295;
/** The ADC cannot read more; a larger value is a broken line. */
export const MAX_MV = 3600;

export type DeviceMode = "ADC" | "SIM";

export type ParsedLine =
  | { type: "sample"; counter: number; mv: number }
  | { type: "status"; counter: number; dropped: number; version: string; mode: DeviceMode }
  | { type: "pong"; version: string }
  | { type: "ok"; detail: string }
  | { type: "error"; detail: string }
  | { type: "info"; fields: Record<string, string> }
  | { type: "invalid"; line: string }
  | { type: "unknown"; line: string };

const SAMPLE = /^E,(\d{1,10}),(\d{1,5})$/;
const STATUS = /^S,(\d{1,10}),(\d{1,10}),([^,\s]+),(ADC|SIM)$/;
const PONG = /^PONG,([^,\s]+)$/;
const INFO_FIELD = /^([a-z_]+)=([^,=]*)$/;
const KNOWN_PREFIXES = ["E,", "S,", "PONG", "OK", "ERR", "I,"];

/** One line, without its line ending. Null for an empty line. */
export function parseLine(raw: string): ParsedLine | null {
  const line = raw.replace(/[\r\n]+$/, "").trimEnd();
  if (line.trim() === "") return null;

  let match = SAMPLE.exec(line);
  if (match) {
    const counter = Number(match[1]);
    const mv = Number(match[2]);
    if (counter <= MAX_COUNTER && mv <= MAX_MV) return { type: "sample", counter, mv };
  } else if ((match = STATUS.exec(line))) {
    const counter = Number(match[1]);
    const dropped = Number(match[2]);
    if (counter <= MAX_COUNTER && dropped <= MAX_COUNTER) {
      return { type: "status", counter, dropped, version: match[3]!, mode: match[4] as DeviceMode };
    }
  } else if ((match = PONG.exec(line))) {
    return { type: "pong", version: match[1]! };
  } else if (line === "OK" || line.startsWith("OK,")) {
    return { type: "ok", detail: line.slice(3) };
  } else if (line === "ERR" || line.startsWith("ERR,")) {
    return { type: "error", detail: line.slice(4) };
  } else if (line.startsWith("I,")) {
    const parts = line.slice(2).split(",");
    const fields: Record<string, string> = {};
    let valid = parts.length > 0;
    for (const part of parts) {
      const field = INFO_FIELD.exec(part);
      if (!field) {
        valid = false;
        break;
      }
      fields[field[1]!] = field[2]!;
    }
    if (valid) return { type: "info", fields };
  }

  if (KNOWN_PREFIXES.some((prefix) => line.startsWith(prefix))) return { type: "invalid", line };
  return { type: "unknown", line };
}

/** The longest partial line kept while waiting for its end; longer junk is dropped. */
export const MAX_PARTIAL_LINE = 256;

/**
 * Splits a stream of text chunks into whole lines. A chunk can end in the middle of a line (the
 * serial port delivers whatever it has); that piece waits for the next chunk.
 */
export class LineSplitter {
  private partial = "";

  push(chunk: string): string[] {
    const text = this.partial + chunk;
    const lines = text.split("\n");
    this.partial = lines.pop() ?? "";
    if (this.partial.length > MAX_PARTIAL_LINE) this.partial = "";
    return lines;
  }

  /** Forgets a partial line, for example after reconnecting. */
  reset(): void {
    this.partial = "";
  }
}

/** The commands the firmware understands. */
export type EmgCommand =
  "START" | "STOP" | "PING" | "SIM ON" | "SIM OFF" | "INFO" | `RATE ${number}`;
