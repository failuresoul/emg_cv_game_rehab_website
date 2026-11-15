"""Login rate limiting (Day 18): after 5 failed logins for an email within 15 minutes, more
attempts for that email are refused (429) until the oldest failure is 15 minutes old. A
successful login clears the count. In memory: a restart clears it, and each server process
has its own (MuVi Rehab runs one)."""

import threading
import time
from collections import deque
from collections.abc import Callable

MAX_FAILURES = 5
WINDOW_S = 15 * 60


class LoginLimiter:
    def __init__(
        self,
        max_failures: int = MAX_FAILURES,
        window_s: float = WINDOW_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_s = window_s
        self.clock = clock
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key(email: str) -> str:
        return email.strip().lower()

    def _recent(self, email: str, now: float) -> deque[float]:
        failures = self._failures.setdefault(self._key(email), deque())
        while failures and now - failures[0] >= self.window_s:
            failures.popleft()
        return failures

    def retry_after(self, email: str) -> int | None:
        """Seconds until the email may try again, or None if it may try now."""
        with self._lock:
            now = self.clock()
            failures = self._recent(email, now)
            if len(failures) < self.max_failures:
                return None
            return max(1, int(failures[0] + self.window_s - now + 0.999))

    def failed(self, email: str) -> None:
        with self._lock:
            now = self.clock()
            self._recent(email, now).append(now)

    def succeeded(self, email: str) -> None:
        with self._lock:
            self._failures.pop(self._key(email), None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()


login_limiter = LoginLimiter()
