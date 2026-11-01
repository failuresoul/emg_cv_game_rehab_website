import { describe, expect, it } from "vitest";

import { POSE } from "@/vision/landmarks";
import { cycles, FRAME_MS, type Sample } from "@/warmup/testSignals";

import { type LabFrame, LabSession } from "./labSession";

/** World landmarks for a left-affected person with the arm raised forward by this angle. */
function frameAt(elevationDeg: number | null, timestamp: number): LabFrame {
  const point = (x: number, y: number, z: number, visibility = 1) => ({ x, y, z, visibility });
  const world = Array.from({ length: 33 }, () => point(0, 0, 0, 0.9));
  world[POSE.LEFT_SHOULDER] = point(0.2, -0.5, 0);
  world[POSE.RIGHT_SHOULDER] = point(-0.2, -0.5, 0);
  world[POSE.LEFT_HIP] = point(0.2, 0, 0);
  world[POSE.RIGHT_HIP] = point(-0.2, 0, 0);
  const radians = ((elevationDeg ?? 0) * Math.PI) / 180;
  const visibility = elevationDeg === null ? 0.1 : 1;
  const y = -0.5 + 0.3 * Math.cos(radians);
  const z = -0.3 * Math.sin(radians);
  world[POSE.LEFT_ELBOW] = point(0.2, y, z, visibility);
  world[POSE.LEFT_WRIST] = point(0.2, -0.5 + 0.6 * Math.cos(radians), 2 * z, visibility);
  return { timestamp, fps: 30, pose: null, poseWorld: world, frameWidth: 640, frameHeight: 480 };
}

function feed(session: LabSession, samples: Sample[], offset = 0) {
  let snapshot = session.process(frameAt(10, offset));
  for (const { value, timestamp } of samples) {
    snapshot = session.process(frameAt(value, offset + FRAME_MS + timestamp));
  }
  return snapshot;
}

const newSession = () =>
  new LabSession({ exerciseId: "shoulder_flexion", preset: "standard", side: "left" });

describe("LabSession", () => {
  it("counts reps from real landmark frames", () => {
    const snapshot = feed(newSession(), cycles({ rest: 10, peak: 120, cycles: 3 }));

    expect(snapshot.fullReps).toBe(3);
    expect(snapshot.counterState).toBe("REST");
    expect(snapshot.raw.armElevationDeg?.source).toBe("3d");
    // Still settling towards 10 degrees just after the last movement.
    expect(snapshot.filtered.armElevationDeg).toBeLessThan(20);
  });

  it("uses the chosen preset's thresholds", () => {
    const session = new LabSession({
      exerciseId: "shoulder_flexion",
      preset: "gentle",
      side: "left",
    });

    expect(session.currentThresholds).toEqual({ low: 30, high: 60 });
    expect(feed(session, cycles({ rest: 10, peak: 70, cycles: 2 })).fullReps).toBe(2);
  });

  it("applies new thresholds and keeps the totals", () => {
    const session = newSession();
    feed(session, cycles({ rest: 10, peak: 120, cycles: 2 }));

    session.setThresholds({ low: 30, high: 60 });
    const snapshot = feed(session, cycles({ rest: 10, peak: 70, cycles: 2 }), 7000);

    expect(snapshot.thresholds).toEqual({ low: 30, high: 60 });
    expect(snapshot.fullReps).toBe(4);
  });

  it("keeps the manual count separate, and reset clears everything", () => {
    const session = newSession();
    feed(session, cycles({ rest: 10, peak: 120, cycles: 2 }));
    session.pressManualCount();
    session.pressManualCount();

    expect(session.process(frameAt(10, 7000)).manualCount).toBe(2);

    session.reset();
    const after = session.process(frameAt(10, 7100));
    expect(after.fullReps).toBe(0);
    expect(after.partialReps).toBe(0);
    expect(after.manualCount).toBe(0);
    expect(after.events).toEqual([]);
  });

  it("keeps only the last 20 events, newest first", () => {
    const session = newSession();
    for (let i = 0; i < 30; i++) session.pressManualCount();

    const { events } = session.process(frameAt(10, 0));

    expect(events).toHaveLength(20);
    expect(events[0].text).toBe("manual count 30");
  });

  it("keeps the chart to the last 10 seconds, ending at now", () => {
    const session = newSession();
    let snapshot = session.process(frameAt(10, 0));
    for (let t = 100; t <= 15000; t += 100) snapshot = session.process(frameAt(10, t));

    expect(snapshot.chart[0].secondsAgo).toBeGreaterThanOrEqual(-10);
    expect(snapshot.chart[snapshot.chart.length - 1].secondsAgo).toBe(0);
  });

  it("does not replace the chart on every frame", () => {
    const session = newSession();
    session.process(frameAt(10, 0));
    const first = session.process(frameAt(10, 300)).chart;

    expect(session.process(frameAt(10, 333)).chart).toBe(first);
  });

  it("pauses after tracking is lost, and never completes a rep across it", () => {
    const session = newSession();
    session.process(frameAt(10, 0));
    session.process(frameAt(100, 800));

    expect(session.process(frameAt(null, 1000)).trackingPaused).toBe(false);
    expect(session.process(frameAt(null, 1400)).trackingPaused).toBe(true);
    const back = session.process(frameAt(10, 2000));

    expect(back.trackingPaused).toBe(false);
    expect(back.fullReps).toBe(0);
  });

  it("restarts when configured for another side", () => {
    const session = newSession();
    feed(session, cycles({ rest: 10, peak: 120, cycles: 1 }));

    session.configure({ exerciseId: "elbow_flexion", preset: "standard", side: "right" });
    const snapshot = session.process(frameAt(10, 4000));

    expect(snapshot.fullReps).toBe(0);
    expect(snapshot.thresholds).toEqual({ low: 70, high: 140 });
  });
});

describe("LabSession recording", () => {
  it("writes a header and only records between start and stop", () => {
    const session = newSession();
    session.process(frameAt(10, 0));
    session.startRecording();
    session.process(frameAt(10, 33));
    session.process(frameAt(10, 66));
    session.stopRecording();
    session.process(frameAt(10, 99));

    const lines = session.toCsv().trim().split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("timestamp_ms,exercise,preset,side,low,high,")).toBe(true);
    expect(lines[0]).toContain("armElevationDeg_raw");
    expect(lines[0]).toContain("elbowFlexionDeg_filtered");
    expect(
      lines[0].endsWith("counter_state,full_reps,partial_reps,manual_count,manual_presses"),
    ).toBe(true);
    expect(lines[1].startsWith("33,shoulder_flexion,standard,left,30,90,")).toBe(true);
  });

  it("records each manual press once, on the next frame", () => {
    const session = newSession();
    session.startRecording();
    session.process(frameAt(10, 0));
    session.pressManualCount();
    session.process(frameAt(10, 33));
    session.process(frameAt(10, 66));

    const rows = session.toCsv().trim().split("\n").slice(1);

    expect(rows.map((row) => row.split(",").at(-1))).toEqual(["0", "1", "0"]);
    expect(rows.map((row) => row.split(",").at(-2))).toEqual(["0", "1", "1"]);
  });

  it("leaves missing measures empty", () => {
    const session = newSession();
    session.startRecording();
    session.process(frameAt(null, 0));

    const [header, row] = session
      .toCsv()
      .trim()
      .split("\n")
      .map((line) => line.split(","));

    expect(row[header.indexOf("armElevationDeg_raw")]).toBe("");
    expect(row[header.indexOf("armElevationDeg_filtered")]).toBe("");
  });

  it("starts a recording afresh, and reset keeps the last one", () => {
    const session = newSession();
    session.startRecording();
    session.process(frameAt(10, 0));
    session.stopRecording();

    session.reset();
    expect(session.hasRecording).toBe(true);

    session.startRecording();
    expect(session.hasRecording).toBe(false);
  });
});
