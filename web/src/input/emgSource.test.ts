import { describe, expect, it } from "vitest";

import { EMG_ALPHA, EmgSource, type EmgReading, percentToLevel } from "./emgSource";
import { InputManager } from "./inputManager";
import {
  type ActivationSource,
  type ActivationSourceId,
  LevelListeners,
  signalSourceId,
} from "./types";

/** A fake EMG engine: no serial port, no hardware. */
class FakeEngine implements EmgReading {
  connected = true;
  streaming = true;
  electrodeOff = false;
  calibrated = true;
  percentMvc: number | null = 0;
  site: "flexors" | "extensors" | null = "flexors";
  gapsPct = 0;
  received = 500;

  getStatus() {
    return {
      connected: this.connected,
      streaming: this.streaming,
      electrodeOff: this.electrodeOff,
      calibrated: this.calibrated,
    };
  }
  arrivalStats() {
    return { gapsPct: this.gapsPct, received: this.received };
  }
}

/** A manual timer: the test calls tick() itself. */
const noTimer = { setTimer: () => 1, clearTimer: () => {} };

class FakeCamera implements ActivationSource {
  readonly id: ActivationSourceId = "cv_grip";
  readonly labelKey = "input.source.cvGrip";
  readonly listeners = new LevelListeners();
  level = 0.2;
  running = false;
  isReady() {
    return true;
  }
  getLevel() {
    return this.level;
  }
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
  }
  subscribe(listener: (level: number) => void) {
    return this.listeners.add(listener);
  }
}

describe("percentToLevel", () => {
  it("maps %MVC to a 0-1 level, clamped", () => {
    expect(percentToLevel(0)).toBe(0);
    expect(percentToLevel(50)).toBe(0.5);
    expect(percentToLevel(100)).toBe(1);
    expect(percentToLevel(120)).toBe(1);
    expect(percentToLevel(-5)).toBe(0);
    expect(percentToLevel(null)).toBe(0);
  });
});

describe("EmgSource", () => {
  it("smooths towards the %MVC level with alpha 0.3", () => {
    const engine = new FakeEngine();
    const source = new EmgSource({ engine, ...noTimer });
    engine.percentMvc = 100;
    source.tick();
    expect(source.getLevel()).toBeCloseTo(EMG_ALPHA, 6);
    source.tick();
    expect(source.getLevel()).toBeCloseTo(EMG_ALPHA + EMG_ALPHA * (1 - EMG_ALPHA), 6);
    for (let index = 0; index < 50; index += 1) source.tick();
    expect(source.getLevel()).toBeCloseTo(1, 3);
  });

  it("is available only when calibrated at its channel's site", () => {
    const engine = new FakeEngine();
    expect(new EmgSource({ channel: "flexor", engine, ...noTimer }).isAvailable()).toBe(true);
    expect(new EmgSource({ channel: "extensor", engine, ...noTimer }).isAvailable()).toBe(false);
    engine.site = "extensors";
    expect(new EmgSource({ channel: "extensor", engine, ...noTimer }).isAvailable()).toBe(true);
    engine.calibrated = false;
    expect(new EmgSource({ channel: "extensor", engine, ...noTimer }).isAvailable()).toBe(false);
    expect(new EmgSource({ channel: "flexor", engine: null }).isAvailable()).toBe(false);
  });

  it("is not ready on electrode-off, disconnect, no samples or more than 1% gaps", () => {
    const engine = new FakeEngine();
    const source = new EmgSource({ engine, ...noTimer });
    expect(source.isReady()).toBe(true);

    engine.electrodeOff = true;
    expect(source.isReady()).toBe(false);
    engine.electrodeOff = false;

    engine.connected = false;
    expect(source.isReady()).toBe(false);
    engine.connected = true;

    engine.received = 0;
    expect(source.isReady()).toBe(false);
    engine.received = 500;

    engine.gapsPct = 1;
    expect(source.isReady()).toBe(true);
    engine.gapsPct = 1.2;
    expect(source.isReady()).toBe(false);
    engine.gapsPct = 0;
    expect(source.isReady()).toBe(true);
  });

  it("reads 0 while paused", () => {
    const engine = new FakeEngine();
    const source = new EmgSource({ engine, ...noTimer });
    engine.percentMvc = 80;
    source.tick();
    expect(source.getLevel()).toBeGreaterThan(0);
    engine.electrodeOff = true;
    expect(source.getLevel()).toBe(0);
  });
});

describe("input manager with the muscle sensor", () => {
  function build() {
    const engine = new FakeEngine();
    const emg = new EmgSource({ engine, ...noTimer });
    const camera = new FakeCamera();
    const manager = new InputManager<ActivationSourceId>([camera, emg], "cv_grip", {
      emg: "cv_grip",
    });
    return { engine, emg, camera, manager };
  }

  it("uses the sensor when chosen and ready", () => {
    const { engine, emg, manager } = build();
    manager.select("emg");
    engine.percentMvc = 100;
    emg.tick();
    expect(manager.effectiveId).toBe("emg");
    expect(manager.usingFallback).toBe(false);
    expect(manager.getLevel()).toBeCloseTo(0.3, 6);
    expect(manager.snapshot()).toMatchObject({
      sourceId: "emg",
      selectedId: "emg",
      fallback: false,
    });
  });

  it("falls back to the camera while paused and recovers on its own", () => {
    const { engine, manager } = build();
    manager.select("emg");

    engine.electrodeOff = true;
    expect(manager.effectiveId).toBe("cv_grip");
    expect(manager.getLevel()).toBe(0.2);
    expect(manager.snapshot()).toMatchObject({
      sourceId: "cv_grip",
      selectedId: "emg",
      fallback: true,
    });

    engine.electrodeOff = false;
    expect(manager.effectiveId).toBe("emg");

    engine.connected = false;
    expect(manager.effectiveId).toBe("cv_grip");
    engine.connected = true;

    engine.gapsPct = 5;
    expect(manager.effectiveId).toBe("cv_grip");
    engine.gapsPct = 0;
    expect(manager.effectiveId).toBe("emg");
    expect(manager.usingFallback).toBe(false);
  });

  it("runs the camera alongside the sensor, so a switch is immediate", () => {
    const { camera, manager } = build();
    manager.select("emg");
    manager.start();
    expect(camera.running).toBe(true);
    manager.stop();
    expect(camera.running).toBe(false);
  });
});

describe("signalSourceId", () => {
  it("names the source of the game's own signal", () => {
    expect(signalSourceId("grip", "emg", "cv_openness")).toBe("emg");
    expect(signalSourceId("grip", "cv_grip", "cv_openness")).toBe("cv_grip");
    expect(signalSourceId("openness", "cv_grip", "emg")).toBe("emg");
    expect(signalSourceId("openness", "cv_grip", "cv_openness")).toBe("cv_grip");
    expect(signalSourceId("openness", "keyboard", "keyboard")).toBe("keyboard");
    expect(signalSourceId(null, "keyboard", "keyboard")).toBe("keyboard");
  });
});
