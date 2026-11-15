# Security and robustness review (Day 18)

Reviewed on 2026-11-16. This page records what was tested, what was found and what was fixed. Every check is automated and runs again with the commands at the end.

- **Status:** MuVi Rehab is a research prototype, not a medical device.
- **Where it runs:** on a local machine or a clinic's own server.

## Summary

| Area                                                   | Result                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Tokens (expiry, tampering, `alg: none`, other secrets) | Every bad token is refused with 401                                                              |
| Patients on admin routes                               | Every admin route answers 403 to a patient and 401 without login                                 |
| A patient on another patient's data                    | Every route with a session, run, report or job id refuses (403/404), for reading and for writing |
| Passwords                                              | 8–128 characters, stored as Argon2 hashes, never returned                                        |
| Login rate limit                                       | **Added:** 5 failed attempts per email per 15 minutes, then 429 with `Retry-After`               |
| Hostile input on every write route                     | No 500s; 422 with field, message and type, never echoing the input                               |
| Request limits                                         | **Added:** 8 MB per body (413) and 32 levels of JSON nesting (422)                               |
| Security headers                                       | **Added:** on the API and on the web app (nginx and `vite preview`)                              |
| Content-Security-Policy                                | **Added:** checked in Chromium with MediaPipe and the fonts loaded, 0 violations                 |
| CORS                                                   | Only the configured origins get CORS headers                                                     |
| Secrets in the web bundle                              | None (scan of `dist/`)                                                                           |
| Model and user text                                    | Always plain text; no raw HTML anywhere in the code                                              |
| Dependencies                                           | `npm audit --omit=dev`: 0. `pip-audit`: 0. Development tools: 9 moderate, none high or critical  |
| Database locked                                        | **Added:** a 15 s busy timeout and WAL, then 503 with `Retry-After`                              |
| Server errors                                          | **Added:** a fixed "Internal server error" message, never a stack trace                          |
| Global error page                                      | Covered by a test                                                                                |

## 1. Authentication and access

The tests are in `server/tests/test_security.py`, `test_access_sweep.py` and `test_auth.py`.

- **Tokens:** HS256 JWTs, which expire after `JWT_EXPIRE_MINUTES`. Each of these is refused with 401 on `/api/auth/me`, an admin route and a patient route:
  - an expired token;
  - one without an expiry or a subject, or with a subject that is not a number;
  - one for an unknown user;
  - one signed with another secret, or with HS512;
  - one with its payload edited to the admin's id and role without signing it again;
  - one with its signature removed;
  - one with `alg: none`;
  - garbage.
- **Deactivated users:** cannot log in, and their tokens stop working.
- **Admin routes:** all routes under `/api/admin`, read from the app's own OpenAPI list, answer 403 to a patient and 401 without a token.
- **Another patient's data:** read from the same list, so a new route is covered without editing the test.
  - **Reading:** every GET with a session, run, report or job id.
  - **Writing:** all 13 POST and PATCH routes with an id: trials, a game's end, calibration, muscle-sensor calibration, warm-up, questionnaire, plan changes, progress, device information, the session's end, a feedback request, report ratings and starting a game.
  - **What the test checks:** every one answers 403 or 404 for another patient's data. For each write route, the owner then sends the same request and it is accepted, so the refusal comes from the ownership check and not from validation.
  - **Data without an id:** the muscle-sensor calibration, metrics and facts routes without an id read only the logged-in patient's own data.
- **Passwords:** 8–128 characters (anything else is 422, on the admin's form and on sign-up). They are stored as Argon2 hashes and never appear in any answer (`test_no_password_leak.py`).
- **Login rate limit (found missing, added):** `app/services/login_limits.py`.
  - **The rule:** after 5 failed logins for an email within 15 minutes, further attempts for that email get 429 with `Retry-After`, until the oldest failure is 15 minutes old. Upper and lower case count as the same email.
  - **What clears it:** a successful login clears the count, and other emails are not affected.
  - **Where it lives:** in memory, one server process, as MuVi Rehab runs. A restart clears it.

## 2. Input validation

- **Every POST, PUT and PATCH body:** from the OpenAPI list, each field in turn is sent as:
  - 200 kB of text;
  - −10¹²;
  - 10³⁰⁸;
  - an object, a list or null;
  - and the whole body as `{}`, `[]`, a string and 1,000 items.

  **Result:** no answer is 500. A 422 lists each problem's location, message and type, and never repeats the rejected input (which could be a password or 200 kB).

- **NaN and Infinity:** refused with 422.
- **Size caps:** these were already in the schemas, and are tested:
  - 2,000 trajectory points per trial;
  - 1,500 muscle-signal trace points per trial;
  - 50 trials per upload;
  - 500 trials per run;
  - text fields limited to their lengths.
- **Request limits (found missing, added):** `app/core/hardening.py`, `BodyGuard`.
  - **Size:** a body over 8 MB is refused with 413, before it is read in full.
  - **Nesting:** JSON nested more than 32 levels deep is refused with 422 before it is parsed. Python's parser would otherwise fail with a `RecursionError`, which is a 500.
  - **The real maximum:** the largest real request, 50 trials of 2,000 points, is about 3 MB and 6 levels deep (tested).

## 3. Web security

- **Security headers (found missing, added).** `web/securityHeaders.ts` is the single list. `vite preview` sends it, and nginx sends the same from `web/security-headers.conf`, which every location of `nginx.conf` includes; a Vitest test keeps the two identical. The API sends its own headers (`hardening.py`).
  - **On every response:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
  - **On the API:** `Cache-Control: no-store`, since its answers are personal data.
  - **`Permissions-Policy`:** the camera and the serial port (Web Serial, for the muscle sensor) for this site only; no microphone, location or USB.
- **Content-Security-Policy:** these are its directives:

  ```
  default-src 'self'
  script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net      (MediaPipe's WASM loader)
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com      (React style attributes)
  font-src 'self' https://fonts.gstatic.com
  img-src 'self' data: blob:;  media-src 'self' blob: mediastream:
  connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com   (WASM, models)
  worker-src 'self' blob:;  object-src 'none';  base-uri 'self';  form-action 'self'
  frame-ancestors 'none'
  ```

  - **Inline code:** no inline or evaluated scripts are allowed. The Vitest tests check that the policy names every URL the app loads (`src/vision/config.ts`, the fonts) and that `index.html` has no inline script.
  - **`npm run check:csp`:** serves the production build with the headers and opens it in headless Chromium. It then loads, under the policy, MediaPipe's WASM loader script, compiles its WASM, downloads a hand model (7.8 MB) and loads the Bengali font.
  - **Result:** everything loaded, with **0 violations**.

- **CORS:** only `CORS_ORIGINS` gets CORS headers. A look-alike origin such as `http://localhost:5173.evil.com`, `null` or any other site gets none (tested).
- **Secrets in the bundle:** `npm run scan:bundle` scans `dist/` for:
  - private keys, JWTs, AWS, Google and other API keys;
  - the server's setting names;
  - password values and the test passwords;
  - test-mode code and source maps.

  **Result:** 54 files, **0 findings**. Test-mode code and `public/test-fixtures` are also left out of the build (Day 18, task 1).

- **Text as text:**
  - **Rendering:** React escapes all text. A test scans every source file for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and `new Function`, and finds none.
  - **A hostile report:** a feedback report whose every text is `<img onerror=…><script>…` is shown as that text, with no element created.

## 4. Dependencies

| Audit                                             | Result                                                                                                                                    | Action                                                                                                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit --omit=dev` (what reaches the browser) | 0 vulnerabilities                                                                                                                         | —                                                                                                                                                                                                  |
| `npm audit` (with the development tools)          | 9 moderate, 0 high, 0 critical: one advisory, `minimatch` ReDoS ("globparts amplification"), reached through ESLint and typescript-eslint | Documented, not fixed: only the linters use it, on our own file names, never in the app or the server. npm's suggested fix downgrades typescript-eslint; take the upstream fix when it is released |
| `pip-audit -r server/requirements.txt`            | No known vulnerabilities                                                                                                                  | —                                                                                                                                                                                                  |

`pip-audit` is a development tool, installed in `server/.venv` only, not in `requirements.txt`.

## 5. Failure handling

- **"Database is locked"** (SQLite):
  - **Waiting:** a file database now waits up to 15 s for another writer (`busy_timeout`, `SQLITE_BUSY_TIMEOUT_S`) instead of failing at once. WAL mode lets readers carry on while one writes. Both are tested.
  - **If it is still locked:** the answer is 503 with `Retry-After: 1` and "The server is busy. Please try again." The browser's requests already retry: queries twice, and game trials with growing delays until saved.
  - **No retries on the server:** whole requests are not repeated on the server, because a request that writes in several steps could be applied twice.
  - **The load test:** 11,890 requests from 10 patients at once had 0 errors (`docs/performance.md`).
- **Server errors:** any unexpected error answers 500 with `{"detail": "Internal server error"}`. The error goes to the server log, not to the browser: a test checks that neither the exception's text nor a traceback is in the answer.
- **The global error page:** a test throws inside a page. The `ErrorBoundary` replaces it with the friendly page (its title, text and "Back to home"), and the error's text is not shown.

## Not covered

- **No HTTPS in the app itself.** Put the server behind HTTPS (a reverse proxy) when it is used beyond one computer. `Strict-Transport-Security` belongs there, not in `nginx.conf`, which also serves plain HTTP locally.
- **Login rate limit is per email.** It does not throttle one address trying many emails. That is acceptable for a clinic's own network; add an IP limit at the proxy if the server is ever exposed.
- **JWTs cannot be revoked one by one** before they expire. Deactivating a user stops their token at once; changing `JWT_SECRET` ends every login.
- **Google Fonts:** the fonts load from Google, so the browser contacts Google. No session data is sent (`privacy.spec.ts`). Self-host the fonts to avoid it.
- **No penetration test.** These are automated checks of known risks, not an external audit.

## How to run the checks

```powershell
cd server; .venv\Scripts\python.exe -m pytest -q tests\test_security.py tests\test_access_sweep.py tests\test_auth.py
cd ..\web; npx vitest run src/security
npm run build; npm run scan:bundle; npm run check:csp
npm audit --omit=dev
cd ..\server; .venv\Scripts\python.exe -m pip_audit -r requirements.txt
```
