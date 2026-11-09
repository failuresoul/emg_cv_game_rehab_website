import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it, vi } from "vitest";

import { apiErrorKey, isSilent, onApiError, reportApiError } from "./apiErrors";

function httpError(status: number | undefined, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  const response =
    status === undefined ? undefined : { status, statusText: "", data: {}, headers: {}, config };
  return new AxiosError("failed", code, config, undefined, response);
}

describe("apiErrorKey", () => {
  it("gives a readable message for each kind of failure", () => {
    expect(apiErrorKey(httpError(undefined))).toBe("apiError.network");
    expect(apiErrorKey(httpError(undefined, "ECONNABORTED"))).toBe("apiError.timeout");
    expect(apiErrorKey(httpError(401))).toBe("apiError.signedOut");
    expect(apiErrorKey(httpError(403))).toBe("apiError.forbidden");
    expect(apiErrorKey(httpError(404))).toBe("apiError.notFound");
    expect(apiErrorKey(httpError(409))).toBe("apiError.conflict");
    expect(apiErrorKey(httpError(422))).toBe("apiError.invalid");
    expect(apiErrorKey(httpError(429))).toBe("apiError.tooMany");
    expect(apiErrorKey(httpError(500))).toBe("apiError.server");
    expect(apiErrorKey(httpError(503))).toBe("apiError.server");
    expect(apiErrorKey(httpError(418))).toBe("apiError.unknown");
    expect(apiErrorKey(new Error("boom"))).toBe("apiError.unknown");
  });
});

describe("reportApiError", () => {
  it("tells every listener, except for a 401", () => {
    const listener = vi.fn();
    const unsubscribe = onApiError(listener);

    reportApiError(httpError(500));
    reportApiError(httpError(401));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("apiError.server");
    unsubscribe();
    reportApiError(httpError(500));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("isSilent", () => {
  it("reads the silent flag", () => {
    expect(isSilent({ silent: true })).toBe(true);
    expect(isSilent({})).toBe(false);
    expect(isSilent(undefined)).toBe(false);
  });
});
