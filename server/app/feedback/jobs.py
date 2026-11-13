"""The report job runner: an in-process asyncio queue with ONE worker, so only one generation
runs on the GPU at a time.

Jobs are LlmReport rows. They live only while the server runs: at start-up, rows left "queued"
or "running" by a stop are queued again and processed. Each attempt is limited by
LLM_TIMEOUT_S and the whole job by LLM_JOB_LIMIT_S, after which the template report is used.
"""

import asyncio
import logging
import threading
import time
from collections.abc import Callable

from sqlalchemy import Engine
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine as app_engine
from app.feedback import store
from app.feedback.llm import LLMError, LLMProvider, get_provider

logger = logging.getLogger(__name__)


class ReportJobs:
    def __init__(self) -> None:
        self.engine: Engine = app_engine
        self.provider_factory: Callable[[], LLMProvider] = get_provider
        self.end_wait_s = settings.FEEDBACK_SESSION_END_WAIT_S
        self.deadline_s = settings.LLM_JOB_LIMIT_S
        #: False leaves jobs queued in the database (most tests).
        self.run_jobs = True
        self._loop: asyncio.AbstractEventLoop | None = None
        #: (priority, order, report id): patients' reports (0) before review sets' (1).
        self._queue: asyncio.PriorityQueue[tuple[int, int, int]] | None = None
        self._order = 0
        self._worker: asyncio.Task[None] | None = None
        self._lock = threading.Lock()
        #: Queued or running job ids.
        self._pending: set[int] = set()
        #: The most jobs ever running at once (one, by design); for tests.
        self.max_running = 0
        self._running = 0

    def configure(
        self,
        *,
        engine: Engine | None = None,
        provider_factory: Callable[[], LLMProvider] | None = None,
        end_wait_s: float | None = None,
        deadline_s: float | None = None,
        run_jobs: bool = True,
    ) -> None:
        """For tests and scripts: where jobs read and write, which model they use, and whether
        they run at all. Called without arguments, it restores the server's settings."""
        self.run_jobs = run_jobs
        self.engine = engine or app_engine
        self.provider_factory = provider_factory or get_provider
        self.end_wait_s = settings.FEEDBACK_SESSION_END_WAIT_S if end_wait_s is None else end_wait_s
        self.deadline_s = settings.LLM_JOB_LIMIT_S if deadline_s is None else deadline_s

    # Life cycle

    async def start(self) -> None:
        """Starts the worker and queues the jobs a stop left unfinished."""
        if not self.run_jobs:
            return
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.PriorityQueue()
        self._pending.clear()
        self.max_running = self._running = 0
        with Session(self.engine) as db:
            unfinished = store.recover(db)
        for report_id, review in unfinished:
            self.enqueue(report_id, background=review)
        if unfinished:
            logger.info("Report jobs: %d unfinished job(s) queued again", len(unfinished))
        self._worker = asyncio.create_task(self._work(), name="report-jobs")

    async def stop(self) -> None:
        if self._worker is not None:
            self._worker.cancel()
            try:
                await self._worker
            except asyncio.CancelledError:
                pass
        self._worker = None
        self._loop = None
        self._queue = None

    # Jobs

    def enqueue(self, report_id: int, background: bool = False) -> None:
        """Queues a job; safe from any thread. `background` jobs (review sets) wait for every
        patient's report. Without a running worker the job stays queued in the database and
        runs at the next start."""
        with self._lock:
            if report_id in self._pending:
                return
            self._pending.add(report_id)
            self._order += 1
            item = (1 if background else 0, self._order, report_id)
        loop, queue = self._loop, self._queue
        if loop is None or queue is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(queue.put_nowait, item)

    @property
    def queue_length(self) -> int:
        """Jobs queued or running."""
        return len(self._pending)

    def wait_until_idle(self, timeout_s: float = 10.0) -> bool:
        """For tests and scripts: True once every queued job has finished."""
        deadline = time.monotonic() + timeout_s
        while self._pending and time.monotonic() < deadline:
            time.sleep(0.02)
        return not self._pending

    async def _work(self) -> None:
        assert self._queue is not None
        while True:
            _, _, report_id = await self._queue.get()
            try:
                await asyncio.to_thread(self.run, report_id)
            finally:
                with self._lock:
                    self._pending.discard(report_id)
                self._queue.task_done()

    def run(self, report_id: int) -> None:
        """One job, start to finish (in a worker thread)."""
        with self._lock:
            self._running += 1
            self.max_running = max(self.max_running, self._running)
        try:
            with Session(self.engine) as db:
                store.run_report(
                    db,
                    report_id,
                    self.provider_factory(),
                    end_wait_s=self.end_wait_s,
                    deadline_s=self.deadline_s,
                )
        except Exception:  # noqa: BLE001  (the worker must keep going)
            logger.exception("Report job %s could not run", report_id)
        finally:
            with self._lock:
                self._running -= 1


def warm_up_quietly(provider: LLMProvider) -> None:
    """Loads the model in the background at start-up; never fails the server."""
    try:
        provider.warm_up()
        logger.info("Feedback model loaded")
    except LLMError as error:
        logger.warning("Feedback model not loaded: %s (reports will use the template)", error)


#: The server's one runner.
report_jobs = ReportJobs()
