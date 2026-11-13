"""Check the EMG stream from the ESP32: the real sampling rate, lost samples and the signal range.

Close the Arduino Serial Monitor and the browser tab first (only one program can use the port).
Run from the repository root:

    server\\.venv\\Scripts\\python.exe -m pip install -r analysis\\requirements.txt   (once: pyserial)
    server\\.venv\\Scripts\\python.exe analysis\\tools\\serial_rate.py --port COM5
    server\\.venv\\Scripts\\python.exe analysis\\tools\\serial_rate.py --port COM5 --sim --seconds 10

Sends START, reads E lines for 60 s (by default), sends STOP, and reports: samples per second,
gaps in the counter (samples lost between the ESP32 and the laptop), the firmware's own dropped
count, and the minimum, maximum and mean millivolts.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

sys.path.insert(0, str(Path(__file__).resolve().parent))

from emg_protocol import parse_line  # noqa: E402

BAUD = 230400


class Port(Protocol):
    def write(self, data: bytes) -> int | None: ...
    def readline(self) -> bytes: ...
    def reset_input_buffer(self) -> None: ...


def send(port: Port, command: str) -> None:
    port.write(f"{command}\n".encode("ascii"))


def summarise(
    samples: list[tuple[int, int]], elapsed_s: float, statuses: list[dict[str, Any]]
) -> dict[str, Any]:
    """The report for (counter, mv) samples received over `elapsed_s` seconds."""
    gaps = missing = restarts = 0
    for (previous, _), (counter, _) in zip(samples, samples[1:], strict=False):
        if counter == previous + 1:
            continue
        if counter > previous + 1:
            gaps += 1
            missing += counter - previous - 1
        else:
            restarts += 1  # the counter went back (START sent again, or a reset)
    values = [mv for _, mv in samples]
    last = statuses[-1] if statuses else None
    return {
        "samples": len(samples),
        "seconds": round(elapsed_s, 2),
        "rate_hz": round(len(samples) / elapsed_s, 1) if elapsed_s > 0 else 0.0,
        "gaps": gaps,
        "missing": missing,
        "restarts": restarts,
        "firmware_dropped": last["dropped"] if last else None,
        "mode": last["mode"] if last else None,
        "version": last["version"] if last else None,
        "min_mv": min(values) if values else None,
        "max_mv": max(values) if values else None,
        "mean_mv": round(statistics.fmean(values), 1) if values else None,
    }


def measure(
    port: Port,
    seconds: float,
    simulate: bool = False,
    rate: int | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Starts the stream, reads it for `seconds`, stops it, and summarises."""
    send(port, "STOP")
    port.reset_input_buffer()
    send(port, "SIM ON" if simulate else "SIM OFF")
    if rate is not None:
        send(port, f"RATE {rate}")
    send(port, "START")

    samples: list[tuple[int, int]] = []
    statuses: list[dict[str, Any]] = []
    invalid = 0
    started: float | None = None
    end = clock() + seconds + 5  # a few seconds' grace for the first sample
    while clock() < end:
        raw = port.readline()
        if not raw:
            continue
        parsed = parse_line(raw.decode("ascii", errors="replace"))
        if parsed is None:
            continue
        if parsed["type"] == "sample":
            if started is None:
                # Time is counted from the first sample, so the start-up delay does not count.
                started = clock()
                end = started + seconds
            samples.append((parsed["counter"], parsed["mv"]))
        elif parsed["type"] == "status":
            statuses.append(parsed)
        elif parsed["type"] == "invalid":
            invalid += 1
    stopped = clock()
    send(port, "STOP")
    report = summarise(samples, (stopped - started) if started is not None else 0.0, statuses)
    report["invalid_lines"] = invalid
    return report


def print_report(report: dict[str, Any], expected_hz: int) -> None:
    print(f"Samples:         {report['samples']} in {report['seconds']} s")
    print(f"Rate:            {report['rate_hz']} per second (expected about {expected_hz})")
    print(f"Counter gaps:    {report['gaps']} ({report['missing']} samples lost on the way)")
    print(f"Firmware drops:  {report['firmware_dropped']}")
    print(f"Counter resets:  {report['restarts']}")
    print(f"Broken lines:    {report['invalid_lines']}")
    print(f"Signal (mV):     min {report['min_mv']}, max {report['max_mv']}, mean {report['mean_mv']}")
    print(f"Mode / firmware: {report['mode']} / {report['version']}")
    if report["samples"] == 0:
        print("No samples arrived. Is the right port chosen, and the Serial Monitor closed?")
    elif report["max_mv"] is not None and report["max_mv"] >= 3000:
        print("The signal reaches 3 V: lower the sensor's gain or check the voltage divider.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Measure the ESP32 EMG stream.")
    parser.add_argument("--port", required=True, help="such as COM5 (Device Manager -> Ports)")
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--sim", action="store_true", help="use the firmware's simulated signal")
    parser.add_argument("--rate", type=int, help="sampling rate to ask for, 100-1000 Hz")
    args = parser.parse_args(argv)

    try:
        import serial  # pyserial: analysis\requirements.txt
    except ImportError:
        print("pyserial is missing: server\\.venv\\Scripts\\python.exe -m pip install -r analysis\\requirements.txt")
        return 1

    try:
        with serial.Serial(args.port, BAUD, timeout=0.5) as port:
            time.sleep(2.0)  # opening the port resets the ESP32: let it boot
            print(f"Reading {args.port} for {args.seconds:g} s{' (simulated signal)' if args.sim else ''}...")
            report = measure(port, args.seconds, simulate=args.sim, rate=args.rate)
    except serial.SerialException as error:
        print(f"Could not open {args.port}: {error}")
        return 1
    print_report(report, args.rate or 500)
    return 0 if report["samples"] > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
