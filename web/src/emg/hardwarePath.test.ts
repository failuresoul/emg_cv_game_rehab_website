/**
 * The whole muscle-sensor path without hardware: a mock ESP32 (mockSerial.ts) speaking the real
 * firmware protocol over the Web Serial interface, through the same code the real board uses —
 * SerialEmgStream -> EmgEngine -> readiness -> calibration (flowReducer) -> %MVC -> the games'
 * EMG source and its camera fallback -> unplug -> plug back in.
 */

import { afterEach, describe, expect, it } from "vitest";

import { t } from "@/i18n";
import { EmgSource } from "@/input/emgSource";
import { InputManager } from "@/input/inputManager";
import type { LevelSource } from "@/input/types";

import { evaluateAttempt, restResult } from "./calibration";
import { EMG, resetEmgSettings } from "./emgSettings";
import { type FlowState, flowReducer, INITIAL_FLOW, qualityOf } from "./emgFlow";
import { EmgEngine, REPLUG_DELAY_MS } from "./engine";
import { type MockBoardOptions, MockSerial } from "./mockSerial";
import { windowStats } from "./processing";
import {
  type CheckId,
  type CheckResult,
  evaluateReadiness,
  evaluateSqueeze,
  gatherReadiness,
  GreenLatch,
  isSensorReady,
  type SqueezeResult,
  steadyChecksGreen,
} from "./readiness";
import { CALIBRATION, READINESS } from "./readinessConfig";
import { SerialEmgStream } from "./serial";

/** Lets the stream's read loop take in what the board printed. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

class Rig {
  clock = 1000;
  readonly serial: MockSerial;
  readonly stream: SerialEmgStream;
  readonly engine: EmgEngine;

  constructor(options: MockBoardOptions = {}) {
    this.serial = new MockSerial(options);
    this.stream = new SerialEmgStream(this.serial, () => this.clock);
    this.engine = new EmgEngine(() => this.clock);
  }

  get firmware() {
    return this.serial.port.firmware;
  }

  async connect(): Promise<void> {
    await this.engine.connectSerial(this.stream);
    await this.run(20);
  }

  /** `ms` of board time, in 100 ms steps (the browser reads in bursts like this). */
  async run(ms: number, step = 100): Promise<void> {
    for (let done = 0; done < ms; done += step) {
      this.clock += step;
      this.serial.advance(step);
      await settle();
    }
  }

  checks(squeeze: SqueezeResult | null = null, webSerialSupported = true): CheckResult[] {
    return evaluateReadiness(
      gatherReadiness(this.engine, this.engine.getStatus(), {
        simulated: false,
        webSerialSupported,
        now: this.clock,
        squeeze,
      }),
    );
  }

  /** The page's test squeeze: the relaxed level just before, then 2 s at `contraction`. */
  async squeeze(contraction: number): Promise<SqueezeResult> {
    const before = windowStats(this.engine.recent(READINESS.relaxedWindowMs / 1000).envelope);
    this.firmware.signal = { ...this.firmware.signal, contraction };
    await this.run(READINESS.squeezeMs);
    this.firmware.signal = { ...this.firmware.signal, contraction: 0 };
    const signal = this.engine.recent(READINESS.squeezeMs / 1000);
    return evaluateSqueeze(signal.t, signal.envelope, { mean: before.mean, sd: before.sd });
  }

  async dispose(): Promise<void> {
    await this.engine.disconnect().catch(() => undefined);
    this.stream.dispose();
  }
}

const passing = (checks: CheckResult[]) =>
  Object.fromEntries(checks.map((check) => [check.id, check.pass])) as Record<CheckId, boolean>;

let rig: Rig | null = null;
afterEach(async () => {
  await rig?.dispose();
  rig = null;
  resetEmgSettings();
});

describe("the mock board speaks the firmware protocol", () => {
  it("answers PING and INFO, starts, and streams at the asked rate", async () => {
    rig = new Rig();
    await rig.connect();
    expect(rig.firmware.received).toEqual(["PING", "INFO", "START"]);
    expect(rig.serial.port.baudRate).toBe(115200);
    const status = rig.engine.getStatus();
    expect(status.connected && status.streaming).toBe(true);
    expect(status.firmwareVersion).toBe("1.0.0");
    expect(rig.engine.getPing().answeredAt).not.toBeNull();

    await rig.engine.send("RATE 300");
    await rig.run(2000);
    expect(rig.engine.sampleRateHz).toBe(333);
    expect(rig.engine.arrivalStats(1000, rig.clock).rateHz).toBeCloseTo(333, -1);
    await rig.engine.send("RATE 500");
    await rig.run(2500);
    expect(rig.engine.arrivalStats(2000, rig.clock).rateHz).toBeCloseTo(500, -1);
  });

  it("reports what the firmware reports: errors, status and SIM mode", async () => {
    rig = new Rig();
    const events: string[] = [];
    rig.engine.onEvent((event) => {
      if (event.type === "error" || event.type === "ok")
        events.push(`${event.type}:${event.detail}`);
    });
    await rig.connect();
    await rig.engine.send("RATE 5000" as const);
    await rig.engine.send("SIM ON");
    await rig.run(1500);
    expect(events).toContain("error:RATE,100-1000");
    expect(events).toContain("ok:SIM,ON");
    expect(rig.engine.getStatus().mode).toBe("SIM");
    // The firmware's simulated envelope is handled exactly like the sensor's: 4 s cycles.
    await rig.run(4000);
    const recent = windowStats(rig.engine.recent(4).envelope);
    expect(recent.peak).toBeGreaterThan(1500);
    expect(recent.min).toBeLessThan(300);
  });

  it("ignores garbled lines and counts the samples they cost as gaps", async () => {
    rig = new Rig({ garbleEvery: 100 });
    const invalid: string[] = [];
    rig.engine.onEvent((event) => {
      if (event.type === "invalid") invalid.push(event.line);
    });
    await rig.connect();
    await rig.run(3000);
    expect(invalid.length).toBeGreaterThan(0);
    const stats = rig.engine.arrivalStats(2000, rig.clock);
    expect(stats.gapsPct).toBeGreaterThan(0.5);
    expect(stats.gapsPct).toBeLessThan(2);
    expect(rig.engine.getStatus().connected).toBe(true);
  });
});

describe("the nine readiness items", () => {
  it("all pass with a good board and electrodes, and the sensor becomes ready", async () => {
    rig = new Rig();
    await rig.connect();
    const latch = new GreenLatch();
    for (let index = 0; index < 16; index += 1) {
      await rig.run(250);
      latch.update(steadyChecksGreen(rig.checks()), rig.clock);
    }
    expect(passing(rig.checks())).toMatchObject({
      webSerial: true,
      connected: true,
      responding: true,
      rate: true,
      gaps: true,
      contact: true,
      saturation: true,
      relaxed: true,
      squeeze: false,
    });
    expect(latch.isLatched).toBe(true);
    const squeeze = await rig.squeeze(0.8);
    expect(squeeze.pass).toBe(true);
    expect(passing(rig.checks(squeeze)).squeeze).toBe(true);
    expect(isSensorReady(latch.isLatched, squeeze.pass)).toBe(true);
  });

  const failures: {
    item: CheckId;
    options?: MockBoardOptions;
    signal?: Partial<{ contraction: number; flat: boolean; saturated: boolean }>;
    connect?: boolean;
    webSerial?: boolean;
  }[] = [
    { item: "webSerial", webSerial: false },
    { item: "connected", connect: false },
    { item: "responding", options: { pongDelayMs: 3000 } },
    { item: "rate", options: { rateScale: 0.9 } },
    { item: "gaps", options: { dropEvery: 50 } },
    { item: "contact", signal: { flat: true } },
    { item: "saturation", signal: { saturated: true } },
    { item: "relaxed", signal: { contraction: 0.5 } },
  ];

  it.each(failures)("$item fails when it should", async (failure) => {
    rig = new Rig(failure.options);
    rig.firmware.signal = { ...rig.firmware.signal, ...failure.signal };
    if (failure.connect !== false) await rig.connect();
    await rig.run(2500);
    const result = passing(rig.checks(null, failure.webSerial ?? true));
    expect(result[failure.item]).toBe(false);
    // The items before it in the list still pass (each failure is reported for itself).
    if (failure.item === "rate" || failure.item === "gaps") {
      expect(result.connected && result.responding).toBe(true);
    }
  });

  it("the squeeze fails when the effort is too weak", async () => {
    rig = new Rig();
    await rig.connect();
    await rig.run(2500);
    const squeeze = await rig.squeeze(0.05);
    expect(squeeze.pass).toBe(false);
    expect(squeeze.ratio).toBeLessThan(READINESS.squeezeMinRatio);
  });

  it("the thresholds come from the EMG settings", async () => {
    rig = new Rig({ rateScale: 0.9 });
    await rig.connect();
    await rig.run(2500);
    expect(passing(rig.checks()).rate).toBe(false);
    EMG.minRateHz = 400;
    expect(passing(rig.checks()).rate).toBe(true);
  });
});

describe("calibration, %MVC, the games, unplugging and plugging back in", () => {
  it("runs the whole path as the session page does", async () => {
    rig = new Rig();
    await rig.connect();
    let state: FlowState = INITIAL_FLOW;
    const act = (action: Parameters<typeof flowReducer>[1]) => (state = flowReducer(state, action));

    // A. Safety and placement.
    act({ type: "chooseSite", site: "flexors" });
    act({ type: "answerSafety", key: "chargerUnplugged", value: true });
    act({ type: "answerSafety", key: "batteriesFresh", value: true });
    act({ type: "answerSafety", key: "electrodesOn", value: true });
    act({ type: "continueToCheck" });
    act({ type: "connected", source: "serial" });
    expect(state.stage).toBe("check");

    // B. The check: green for 2 s, then the test squeeze.
    const latch = new GreenLatch();
    for (let index = 0; index < 12; index += 1) {
      await rig.run(250);
      latch.update(steadyChecksGreen(rig.checks()), rig.clock);
    }
    const squeeze = await rig.squeeze(0.8);
    act({ type: "squeezeTested", result: squeeze });
    await rig.run(1000);
    act({ type: "ready", readiness: rig.checks(squeeze) });
    expect(state.stage).toBe("calibrate");

    // C. Rest 10 s, then three maximum efforts.
    act({ type: "startRest", now: rig.clock });
    await rig.run(CALIBRATION.restMs);
    const rest = restResult(rig.engine.recent(CALIBRATION.restMs / 1000).envelope);
    expect(rest.problem).toBeNull();
    act({ type: "restDone", result: rest });
    for (const strength of [0.95, 1, 0.97]) {
      act({ type: "startAttempt", now: rig.clock });
      await rig.run(CALIBRATION.countdownMs);
      act({ type: "countdownDone", now: rig.clock });
      rig.firmware.signal = { ...rig.firmware.signal, contraction: strength };
      await rig.run(CALIBRATION.effortMs);
      rig.firmware.signal = { ...rig.firmware.signal, contraction: 0 };
      const signal = rig.engine.recent(CALIBRATION.effortMs / 1000);
      act({
        type: "attemptDone",
        result: evaluateAttempt(signal.mv, signal.envelope, rig.engine.sampleRateHz),
        trace: [],
        now: rig.clock,
        pauseMs: 0,
      });
      act({ type: "pauseDone" });
      await rig.run(500);
    }
    expect(state.stage).toBe("summary");
    expect(state.mvc?.consistent).toBe(true);
    expect(state.mvc!.mvc).toBeGreaterThan(1600);
    expect(qualityOf(state, 0, "ADC")).toMatchObject({ device_mode: "ADC", saturation: false });

    // %MVC once calibrated.
    rig.engine.setSite("flexors");
    rig.engine.setCalibration({ restMean: rest.mean, restSd: rest.sd, mvc: state.mvc!.mvc });
    rig.firmware.signal = { ...rig.firmware.signal, contraction: 0.5 };
    await rig.run(500);
    expect(rig.engine.percentMvc).toBeGreaterThan(40);
    expect(rig.engine.percentMvc).toBeLessThan(60);

    // The games: the muscle sensor drives the level (the camera is the fallback).
    let tick: (() => void) | null = null;
    const emg = new EmgSource({
      channel: "flexor",
      engine: rig.engine,
      setTimer: (callback) => (tick = callback),
      clearTimer: () => (tick = null),
    });
    const camera: LevelSource<"cv_grip"> = {
      id: "cv_grip",
      labelKey: "input.source.cvGrip",
      isReady: () => true,
      getLevel: () => 0.1,
      start: () => undefined,
      stop: () => undefined,
      subscribe: () => () => undefined,
    };
    const manager = new InputManager<"emg" | "cv_grip">([camera, emg], "cv_grip", {
      emg: "cv_grip",
    });
    manager.start();
    expect(emg.isAvailable()).toBe(true);
    manager.select("emg");
    for (let index = 0; index < 20; index += 1) tick!();
    expect(manager.snapshot().sourceId).toBe("emg");
    expect(manager.snapshot().fallback).toBe(false);
    expect(manager.getLevel()).toBeGreaterThan(0.4);

    // Unplugged: the game falls back to the camera and says so.
    rig.serial.unplug();
    await rig.stream.whenClosed();
    await settle();
    expect(rig.engine.getStatus()).toMatchObject({ connected: false, error: "lost" });
    tick!();
    expect(manager.snapshot()).toMatchObject({ sourceId: "cv_grip", fallback: true });
    expect(t("game.emgPaused")).toMatch(/camera/i);

    // Plugged back in: reopened without a chooser, pinged and started; calibration kept.
    rig.serial.replug();
    await new Promise((resolve) => setTimeout(resolve, REPLUG_DELAY_MS + 50));
    await rig.run(1500);
    expect(rig.engine.getStatus()).toMatchObject({ connected: true, streaming: true });
    expect(rig.firmware.received).toEqual(["PING", "INFO", "START"]);
    expect(rig.engine.getCalibration()).not.toBeNull();
    for (let index = 0; index < 20; index += 1) tick!();
    expect(manager.snapshot()).toMatchObject({ sourceId: "emg", fallback: false });
    manager.stop();
  }, 60_000);

  it("a saturated effort is repeated, and a weak MVC is refused", async () => {
    rig = new Rig();
    await rig.connect();
    await rig.run(1000);
    rig.firmware.signal = { ...rig.firmware.signal, saturated: true };
    await rig.run(CALIBRATION.effortMs);
    const signal = rig.engine.recent(CALIBRATION.effortMs / 1000);
    expect(evaluateAttempt(signal.mv, signal.envelope, 500).saturated).toBe(true);
  });
});
