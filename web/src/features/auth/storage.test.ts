// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { clearToken, getToken, saveToken } from "./storage";

afterEach(() => localStorage.clear());

describe("the saved login", () => {
  it("is kept under muvi_token", () => {
    saveToken("abc");
    expect(localStorage.getItem("muvi_token")).toBe("abc");
    expect(getToken()).toBe("abc");
    clearToken();
    expect(getToken()).toBeNull();
  });

  it("moves a login saved under the old key (before Day 20), so nobody is logged out", () => {
    localStorage.setItem("motionlab_token", "old");
    expect(getToken()).toBe("old");
    expect(localStorage.getItem("muvi_token")).toBe("old");
    expect(localStorage.getItem("motionlab_token")).toBeNull();
  });

  it("logging out clears both keys", () => {
    localStorage.setItem("motionlab_token", "old");
    saveToken("new");
    clearToken();
    expect(localStorage.getItem("motionlab_token")).toBeNull();
    expect(getToken()).toBeNull();
  });
});
