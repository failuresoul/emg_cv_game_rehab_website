"""The lines the EMG firmware (firmware/emg_stream/emg_stream.ino) prints, and how to read them.

The browser (web/src/input/emg/) follows exactly the same rules; firmware/test-lines.txt holds
examples with their expected results, checked by tests on both sides.

    E,<counter>,<mv>                            a sample
    S,<counter>,<dropped>,<version>,<ADC|SIM>   status, once per second
    PONG,<version>                              the answer to PING
    OK,<what>   ERR,<why>                       answers to commands
    I,key=value,...                             settings (INFO, and at start-up)

A line is read without its line ending (a trailing carriage return is removed). A line that starts
like one of these but breaks its rules is "invalid"; anything else (such as the ESP32's boot
messages) is "unknown". Empty lines give None.
"""

from __future__ import annotations

import re
from typing import Any

MAX_COUNTER = 4_294_967_295  # uint32
MAX_MV = 3600  # the ADC cannot read more; anything above is a broken line

_SAMPLE = re.compile(r"E,(\d{1,10}),(\d{1,5})")
_STATUS = re.compile(r"S,(\d{1,10}),(\d{1,10}),([^,\s]+),(ADC|SIM)")
_PONG = re.compile(r"PONG,([^,\s]+)")
_INFO_FIELD = re.compile(r"([a-z_]+)=([^,=]*)")
_KNOWN_PREFIXES = ("E,", "S,", "PONG", "OK", "ERR", "I,")


def parse_line(raw: str) -> dict[str, Any] | None:
    line = raw.rstrip("\r\n").rstrip()
    if not line.strip():
        return None

    if match := _SAMPLE.fullmatch(line):
        counter, mv = int(match.group(1)), int(match.group(2))
        if counter <= MAX_COUNTER and mv <= MAX_MV:
            return {"type": "sample", "counter": counter, "mv": mv}
    elif match := _STATUS.fullmatch(line):
        counter, dropped = int(match.group(1)), int(match.group(2))
        if counter <= MAX_COUNTER and dropped <= MAX_COUNTER:
            return {
                "type": "status",
                "counter": counter,
                "dropped": dropped,
                "version": match.group(3),
                "mode": match.group(4),
            }
    elif match := _PONG.fullmatch(line):
        return {"type": "pong", "version": match.group(1)}
    elif line == "OK" or line.startswith("OK,"):
        return {"type": "ok", "detail": line[3:]}
    elif line == "ERR" or line.startswith("ERR,"):
        return {"type": "error", "detail": line[4:]}
    elif line.startswith("I,"):
        parts = line[2:].split(",")
        fields = [_INFO_FIELD.fullmatch(part) for part in parts]
        if parts and all(fields):
            return {"type": "info", "fields": {m.group(1): m.group(2) for m in fields if m}}

    if line.startswith(_KNOWN_PREFIXES):
        return {"type": "invalid", "line": line}
    return {"type": "unknown", "line": line}
