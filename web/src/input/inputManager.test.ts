import { describe, expect, it } from "vitest";

import { EmgSource } from "./emgSource";
import { type ActivationSnapshot, InputManager } from "./inputManager";
import { type ActivationSource, type ActivationSourceId, LevelListeners } from "./types";

class FakeSource implements ActivationSource {
  readonly labelKey = "input.source.keyboard";
  readonly listeners = new LevelListeners();
  level = 0;
  ready = true;
  running = false;

  readonly id: ActivationSourceId;

  constructor(id: ActivationSourceId) {
    this.id = id;
  }

  isReady() {
    return this.ready;
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
  set(level: number) {
    this.level = level;
    this.listeners.emit(level);
  }
}

function create() {
  const grip = new FakeSource("cv_grip");
  const keyboard = new FakeSource("keyboard");
  const manager = new InputManager([grip, keyboard, new EmgSource()]);
  const snapshots: ActivationSnapshot[] = [];
  manager.subscribe((snapshot) => snapshots.push(snapshot));
  return { grip, keyboard, manager, snapshots };
}

describe("InputManager", () => {
  it("uses the camera grip by default", () => {
    const { manager } = create();
    expect(manager.sourceId).toBe("cv_grip");
  });

  it("runs only the chosen source and passes on its level", () => {
    const { grip, keyboard, manager, snapshots } = create();
    manager.start();
    expect(grip.running).toBe(true);
    expect(keyboard.running).toBe(false);

    grip.set(0.4);
    keyboard.set(0.9); // Not chosen: ignored.
    expect(manager.getLevel()).toBe(0.4);
    expect(snapshots.at(-1)).toEqual({
      sourceId: "cv_grip",
      level: 0.4,
      ready: true,
      selectedId: "cv_grip",
      fallback: false,
    });
    expect(snapshots).toHaveLength(2);
  });

  it("toggles keyboard input on and back to the previous source", () => {
    const { grip, keyboard, manager, snapshots } = create();
    manager.start();
    manager.toggleKeyboard();
    expect(manager.sourceId).toBe("keyboard");
    expect(grip.running).toBe(false);
    expect(keyboard.running).toBe(true);
    expect(snapshots.at(-1)?.sourceId).toBe("keyboard");

    manager.toggleKeyboard();
    expect(manager.sourceId).toBe("cv_grip");
    expect(grip.running).toBe(true);
    expect(keyboard.running).toBe(false);
  });

  it("stops the source and its updates on stop()", () => {
    const { grip, manager, snapshots } = create();
    manager.start();
    manager.stop();
    expect(grip.running).toBe(false);
    const count = snapshots.length;
    grip.set(0.7);
    expect(snapshots).toHaveLength(count);
  });

  it("reports the EMG placeholder as never ready", () => {
    const { manager } = create();
    manager.select("emg");
    expect(manager.isReady()).toBe(false);
    expect(manager.getLevel()).toBe(0);
  });

  it("rejects an initial source it does not have", () => {
    expect(() => new InputManager([new FakeSource("keyboard")])).toThrow();
  });
});
