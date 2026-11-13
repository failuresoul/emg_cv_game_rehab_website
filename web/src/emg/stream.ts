import type { DeviceMode, EmgCommand } from "./protocol";

export type EmgSourceKind = "serial" | "simulated";

/** Why a connection ended or could not start; the UI words each with t(). */
export type EmgErrorCode =
  | "not_supported" // no Web Serial (only Chrome and Edge have it)
  | "no_port" // the person closed the port chooser
  | "open_failed" // the port is busy (the Arduino Serial Monitor?) or missing
  | "lost" // unplugged, or the connection broke
  | "write_failed";

export type EmgEvent =
  | { type: "connected" }
  | { type: "disconnected"; error: EmgErrorCode | null }
  | { type: "samples"; samples: { counter: number; mv: number }[]; arrivalMs: number }
  | { type: "status"; counter: number; dropped: number; version: string; mode: DeviceMode }
  | { type: "pong"; version: string }
  | { type: "ok"; detail: string }
  | { type: "error"; detail: string }
  | { type: "info"; fields: Record<string, string> }
  | { type: "invalid"; line: string };

/** A source of firmware events: the ESP32 over Web Serial, or the simulated one. */
export interface EmgStream {
  readonly kind: EmgSourceKind;
  readonly connected: boolean;
  /** Serial: must be called from a click (the browser shows its port chooser). */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: EmgCommand): Promise<void>;
  subscribe(listener: (event: EmgEvent) => void): () => void;
}

export class EmgError extends Error {
  readonly code: EmgErrorCode;

  constructor(code: EmgErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** The listener bookkeeping both streams share. */
export class EventHub {
  private readonly listeners = new Set<(event: EmgEvent) => void>();

  subscribe(listener: (event: EmgEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: EmgEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
