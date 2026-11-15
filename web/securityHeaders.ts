/**
 * The web app's security headers (Day 18), in one place: `vite preview` sends them, and
 * nginx.conf (production) has the same lines in security-headers.conf, which a Vitest test keeps
 * identical.
 *
 * The Content-Security-Policy allows only what the app loads:
 * - MediaPipe: its WASM loader script from cdn.jsdelivr.net ('wasm-unsafe-eval' to compile the
 *   WASM) and the models from storage.googleapis.com (src/vision/config.ts);
 * - Google Fonts: the stylesheets (fonts.googleapis.com) and font files (fonts.gstatic.com);
 * - inline style attributes (React's style={...}); no inline scripts;
 * - the camera stream and canvases (blob:, data: images).
 * Web Serial and the camera are browser permissions, allowed for this site only by
 * Permissions-Policy; no other site can embed the app (frame-ancestors 'none').
 */

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), serial=(self), microphone=(), geolocation=(), usb=()",
};
