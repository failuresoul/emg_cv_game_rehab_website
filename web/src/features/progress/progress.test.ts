import { describe, expect, it } from "vitest";

import type { CalendarDay, ProgressPoint } from "@/types/api";

import {
  calendarWeeks,
  compare,
  goalShare,
  localDate,
  parseWeeklyGoal,
  ringDash,
  trendSeries,
  tzOffsetMinutes,
} from "./progress";

describe("compare", () => {
  it("is null without both values", () => {
    expect(compare(null, 3, "count")).toBeNull();
    expect(compare(3, null, "count")).toBeNull();
    expect(compare(undefined, 3, "share")).toBeNull();
    expect(compare(Number.NaN, 3, "relative")).toBeNull();
  });

  it("counts any change of a whole number", () => {
    expect(compare(5, 4, "count")).toBe("better");
    expect(compare(4, 4, "count")).toBe("same");
    expect(compare(3, 4, "count")).toBe("lower");
  });

  it("treats a change within 5% as the same", () => {
    expect(compare(105, 100, "relative")).toBe("same");
    expect(compare(95, 100, "relative")).toBe("same");
    expect(compare(106, 100, "relative")).toBe("better");
    expect(compare(94, 100, "relative")).toBe("lower");
    expect(compare(1.26, 1.2, "relative")).toBe("same");
    expect(compare(0, 0, "relative")).toBe("same");
    expect(compare(2, 0, "relative")).toBe("better");
  });

  it("treats a share within 5 points as the same", () => {
    expect(compare(0.75, 0.7, "share")).toBe("same");
    expect(compare(0.65, 0.7, "share")).toBe("same");
    expect(compare(0.76, 0.7, "share")).toBe("better");
    expect(compare(0.6, 0.7, "share")).toBe("lower");
  });
});

function point(changes: Partial<ProgressPoint>): ProgressPoint {
  return {
    session_id: 1,
    date: "2026-11-01T10:00:00Z",
    hull_area_sw2: 1.234,
    warmup_goals_reached: 4,
    warmup_total: 6,
    game_success_rate: 0.666,
    total_reps: 40,
    ...changes,
  };
}

describe("trendSeries", () => {
  it("builds the three lines with rounded values", () => {
    const series = trendSeries([point({})], (iso) => iso.slice(0, 10));

    expect(series.reachArea).toEqual([{ label: "2026-11-01", value: 1.23 }]);
    expect(series.warmupGoals).toEqual([{ label: "2026-11-01", value: 4 }]);
    expect(series.successRate).toEqual([{ label: "2026-11-01", value: 67 }]);
  });

  it("leaves out sessions with nothing for a line", () => {
    const series = trendSeries(
      [
        point({ date: "2026-11-01T10:00:00Z" }),
        point({
          date: "2026-11-02T10:00:00Z",
          hull_area_sw2: null,
          warmup_total: 0,
          warmup_goals_reached: 0,
          game_success_rate: null,
        }),
        point({ date: "2026-11-03T10:00:00Z", warmup_goals_reached: 0 }),
      ],
      (iso) => iso.slice(8, 10),
    );

    expect(series.reachArea.map((p) => p.label)).toEqual(["01", "03"]);
    // A warm-up with no goals reached is still a point.
    expect(series.warmupGoals).toEqual([
      { label: "01", value: 4 },
      { label: "03", value: 0 },
    ]);
    expect(series.successRate.map((p) => p.label)).toEqual(["01", "03"]);
  });

  it("is empty without sessions", () => {
    expect(trendSeries([], String)).toEqual({ reachArea: [], warmupGoals: [], successRate: [] });
  });
});

describe("goalShare and ringDash", () => {
  it("fills up to the goal and no further", () => {
    expect(goalShare(0, 5)).toBe(0);
    expect(goalShare(3, 5)).toBeCloseTo(0.6);
    expect(goalShare(7, 5)).toBe(1);
    expect(goalShare(1, 0)).toBe(1);
  });

  it("splits the circumference", () => {
    const [filled, rest] = ringDash(0.25, 10).split(" ").map(Number);
    const circumference = 2 * Math.PI * 10;
    expect(filled).toBeCloseTo(circumference / 4);
    expect(rest).toBeCloseTo((circumference * 3) / 4);
    expect(ringDash(2, 10).split(" ").map(Number)[1]).toBeCloseTo(0);
  });
});

describe("calendarWeeks", () => {
  it("makes four weeks of seven from 28 days", () => {
    const days: CalendarDay[] = Array.from({ length: 28 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      completed: index % 2,
    }));

    const weeks = calendarWeeks(days);

    expect(weeks).toHaveLength(4);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[3]?.[6]?.date).toBe("2026-10-28");
  });
});

describe("localDate", () => {
  it("keeps the calendar day whatever the time zone", () => {
    const date = localDate("2026-11-10");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(10);
    expect(date.getDate()).toBe(10);
  });
});

describe("tzOffsetMinutes", () => {
  it("is minutes ahead of UTC", () => {
    const dhaka = { getTimezoneOffset: () => -360 } as Date;
    const newYork = { getTimezoneOffset: () => 300 } as Date;
    const utc = { getTimezoneOffset: () => 0 } as Date;

    expect(tzOffsetMinutes(dhaka)).toBe(360);
    expect(tzOffsetMinutes(newYork)).toBe(-300);
    expect(Object.is(tzOffsetMinutes(utc), 0)).toBe(true);
  });
});

describe("parseWeeklyGoal", () => {
  it("accepts whole numbers from 1 to 14", () => {
    expect(parseWeeklyGoal("1")).toBe(1);
    expect(parseWeeklyGoal(" 5 ")).toBe(5);
    expect(parseWeeklyGoal("14")).toBe(14);
  });

  it("rejects anything else", () => {
    for (const text of ["", "0", "15", "2.5", "-3", "abc", "3a"]) {
      expect(parseWeeklyGoal(text)).toBeNull();
    }
  });
});
