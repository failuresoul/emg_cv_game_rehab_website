import { describe, expect, it, vi } from "vitest";

import { StopRegistry } from "./sessionStop";

describe("StopRegistry", () => {
  it("runs every stopper once, then is empty", () => {
    const registry = new StopRegistry();
    const loop = vi.fn();
    const camera = vi.fn();
    registry.register(loop);
    registry.register(camera);

    expect(registry.stopAll()).toBe(2);
    expect(loop).toHaveBeenCalledTimes(1);
    expect(camera).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
    expect(registry.stopAll()).toBe(0);
    expect(loop).toHaveBeenCalledTimes(1);
  });

  it("forgets a stopper removed on unmount", () => {
    const registry = new StopRegistry();
    const stop = vi.fn();
    const unregister = registry.register(stop);

    unregister();

    expect(registry.stopAll()).toBe(0);
    expect(stop).not.toHaveBeenCalled();
  });

  it("keeps going when one stopper throws", () => {
    const registry = new StopRegistry();
    const after = vi.fn();
    registry.register(() => {
      throw new Error("already stopped");
    });
    registry.register(after);

    expect(registry.stopAll()).toBe(2);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
