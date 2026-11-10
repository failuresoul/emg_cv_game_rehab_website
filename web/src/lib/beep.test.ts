import { afterEach, describe, expect, it, vi } from "vitest";

import { closeAudio, playTick, prepareAudio } from "./beep";

/** A stand-in for the browser's AudioContext that records what was asked of it. */
class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  oscillators = 0;

  constructor() {
    FakeAudioContext.created.push(this);
  }

  createOscillator() {
    this.oscillators++;
    const node = { frequency: { value: 0 }, connect: () => node, start() {}, stop() {} };
    return node;
  }

  createGain() {
    const node = {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect: () => node,
    };
    return node;
  }
}

describe("audio context", () => {
  afterEach(() => {
    closeAudio();
    FakeAudioContext.created = [];
    vi.unstubAllGlobals();
  });

  it("is made and resumed on a user's click, and reused after that", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    playTick(); // Before any click: silent, and no context is made.
    expect(FakeAudioContext.created).toHaveLength(0);

    prepareAudio();
    prepareAudio();
    expect(FakeAudioContext.created).toHaveLength(1);
    const [context] = FakeAudioContext.created;
    expect(context.resume).toHaveBeenCalledTimes(2);
    playTick();
    expect(context.oscillators).toBe(1);
  });

  it("is closed when leaving, and a new one is made on the next click", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    prepareAudio();
    const [first] = FakeAudioContext.created;
    closeAudio();
    expect(first.close).toHaveBeenCalledTimes(1);

    playTick(); // Closed: silent.
    expect(first.oscillators).toBe(0);
    prepareAudio();
    expect(FakeAudioContext.created).toHaveLength(2);
    closeAudio();
    closeAudio(); // Twice is harmless.
    expect(FakeAudioContext.created[1].close).toHaveBeenCalledTimes(1);
  });
});
