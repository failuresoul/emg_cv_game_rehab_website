import { describe, expect, it } from "vitest";

import { homeForPath } from "./homePath";

describe("homeForPath", () => {
  it("goes to the home of the area the error happened in", () => {
    expect(homeForPath("/session/game/balloon_pop")).toBe("/patient");
    expect(homeForPath("/patient/progress")).toBe("/patient");
    expect(homeForPath("/admin/sessions/4")).toBe("/admin");
    expect(homeForPath("/login")).toBe("/");
    expect(homeForPath("/")).toBe("/");
  });
});
