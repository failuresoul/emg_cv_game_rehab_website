import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { t } from "@/i18n";

import { errorMessage } from "./LoginPage";

const withStatus = (status: number) =>
  new AxiosError("failed", "ERR", undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });

describe("the login page's error message", () => {
  it("says which problem it is", () => {
    expect(errorMessage(withStatus(401))).toBe(t("login.error.invalid"));
    // The server's limit: 5 failed logins for an email in 15 minutes.
    expect(errorMessage(withStatus(429))).toBe(t("apiError.tooMany"));
    expect(errorMessage(withStatus(500))).toBe(t("login.error.generic"));
    expect(errorMessage(new Error("offline"))).toBe(t("login.error.generic"));
  });
});
