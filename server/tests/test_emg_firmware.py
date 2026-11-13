"""The EMG firmware's lines (firmware/test-lines.txt, shared with the browser), the serial rate
tool with a fake port, and static checks of the .ino (it cannot be compiled here)."""

import importlib.util
import json
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIRMWARE = ROOT / "firmware"
TOOLS = ROOT / "analysis" / "tools"


def load(name: str) -> ModuleType:
    sys.path.insert(0, str(TOOLS))
    spec = importlib.util.spec_from_file_location(name, TOOLS / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


protocol = load("emg_protocol")


def fixture_cases() -> list[tuple[str, Any]]:
    """(raw line, expected) from firmware/test-lines.txt: the raw part ends at the first " => ";
    "\\r" in it stands for a carriage return."""
    cases = []
    for line in (FIRMWARE / "test-lines.txt").read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        raw, _, expected = line.partition(" => ")
        cases.append((raw.replace("\\r", "\r"), json.loads(expected)))
    return cases


CASES = fixture_cases()


def test_the_fixture_covers_every_kind_of_line() -> None:
    kinds = {expected["type"] if expected else None for _, expected in CASES}
    assert kinds == {"sample", "status", "pong", "ok", "error", "info", "invalid", "unknown", None}
    assert len(CASES) >= 30


@pytest.mark.parametrize(("raw", "expected"), CASES, ids=[repr(raw) for raw, _ in CASES])
def test_each_example_line_is_read_as_the_browser_will(raw: str, expected: Any) -> None:
    assert protocol.parse_line(raw) == expected


# The serial rate tool, with a fake ESP32


class FakePort:
    """Answers the tool's commands and streams the given lines, one per readline; a fake clock
    moves 2 ms per line (500 Hz)."""

    def __init__(self, lines: list[str]) -> None:
        self.lines = [line.encode("ascii") for line in lines]
        self.written: list[str] = []
        self.now = 0.0

    def write(self, data: bytes) -> int:
        self.written.append(data.decode("ascii"))
        return len(data)

    def readline(self) -> bytes:
        self.now += 0.002
        return self.lines.pop(0) if self.lines else b""

    def reset_input_buffer(self) -> None:
        pass

    def clock(self) -> float:
        return self.now


def test_measure_reports_rate_gaps_and_range() -> None:
    tool = load("serial_rate")
    lines = ["ets Jun  8 2016 00:22:57\n", "OK,START\n"]
    counters = [c for c in range(1000) if c not in (100, 101, 102, 500)]  # 4 lost samples
    lines += [f"E,{c},{200 + (c % 10) * 100}\r\n" for c in counters]
    lines.insert(400, "E,40\n")  # a broken line
    lines.insert(300, "S,297,2,1.0.0,SIM\n")
    port = FakePort(lines)
    report = tool.measure(port, seconds=1.99, simulate=True, rate=500, clock=port.clock)

    assert port.written[:4] == ["STOP\n", "SIM ON\n", "RATE 500\n", "START\n"]
    assert port.written[-1] == "STOP\n"
    # The window is about 2 s of a 2 ms clock: nearly every one of the 996 samples.
    assert 985 <= report["samples"] <= 996
    assert report["gaps"] == 2 and report["missing"] == 4 and report["restarts"] == 0
    assert report["firmware_dropped"] == 2 and report["mode"] == "SIM" and report["version"] == "1.0.0"
    assert (report["min_mv"], report["max_mv"]) == (200, 1100)
    assert report["invalid_lines"] == 1
    assert 450 < report["rate_hz"] < 550


def test_summarise_counts_restarts_and_handles_nothing() -> None:
    tool = load("serial_rate")
    report = tool.summarise([(0, 200), (1, 210), (0, 205), (1, 190)], 0.008, [])
    assert report["restarts"] == 1 and report["gaps"] == 0 and report["rate_hz"] == 500.0
    empty = tool.summarise([], 0.0, [])
    assert empty["samples"] == 0 and empty["rate_hz"] == 0.0 and empty["mean_mv"] is None


def test_the_tool_explains_a_missing_pyserial(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    tool = load("serial_rate")
    monkeypatch.setitem(sys.modules, "serial", None)  # import serial fails
    assert tool.main(["--port", "COM99"]) == 1
    assert "pip install -r analysis" in capsys.readouterr().out


# The firmware source


INO = (FIRMWARE / "emg_stream" / "emg_stream.ino").read_text(encoding="utf-8")


def function_body(name: str) -> str:
    start = INO.index(f"{name}(")
    open_brace = INO.index("{", start)
    depth = 0
    for index in range(open_brace, len(INO)):
        depth += {"{": 1, "}": -1}.get(INO[index], 0)
        if depth == 0:
            return INO[open_brace : index + 1]
    raise AssertionError(name)


def test_the_firmware_settings() -> None:
    for setting in (
        "EMG_PIN = 34;", "SAMPLE_HZ = 500;", "BAUD = 230400;", 'FW_VERSION[] = "1.0.0";',
        "LED_PIN = 2;", "QUEUE_LENGTH = 512;", "MIN_HZ = 100;", "MAX_HZ = 1000;",
    ):  # fmt: skip
        assert setting in INO, setting
    assert "analogReadResolution(12);" in INO
    assert "analogSetPinAttenuation(EMG_PIN, EMG_ATTENUATION);" in INO
    assert "analogReadMilliVolts(EMG_PIN)" in INO


def test_the_attenuation_builds_on_core_2_and_3() -> None:
    guard = re.search(r"#if defined\(ESP_ARDUINO_VERSION_MAJOR\) && \(ESP_ARDUINO_VERSION_MAJOR >= 3\)(.*?)#else(.*?)#endif", INO, re.S)
    assert guard is not None
    assert "ADC_ATTEN_DB_12" in guard.group(1) and "hal/adc_types.h" in guard.group(1)
    assert "ADC_11db" in guard.group(2)


def test_the_sampler_runs_on_core_0_and_never_prints_or_allocates() -> None:
    body = function_body("static void samplerTask")
    assert "vTaskDelayUntil(&lastWake" in body
    assert "xQueueSend(sampleQueue, &sample, 0)" in body and "droppedCount" in body
    for forbidden in ("Serial", "printf", "malloc", "new ", "String"):
        assert forbidden not in body, forbidden
    assert re.search(r"xTaskCreatePinnedToCore\(samplerTask,.*?,\s*0\);", INO, re.S)
    assert "xQueueCreateStatic(QUEUE_LENGTH, sizeof(Sample)" in INO
    for forbidden in ("malloc(", "String ", "new Sample"):
        assert forbidden not in INO, forbidden


def test_the_firmware_prints_the_lines_the_parser_reads() -> None:
    """The format strings of the .ino, filled in, are read correctly."""
    samples = {
        '"E,%lu,%u\\n"': "E,12,1834",
        '"S,%lu,%lu,%s,%s\\n"': "S,12,0,1.0.0,ADC",
        '"PONG,%s"': "PONG,1.0.0",
        '"OK,RATE,%lu"': "OK,RATE,333",
        '"ERR,UNKNOWN,%s"': "ERR,UNKNOWN,FOO",
    }
    for format_string, example in samples.items():
        assert format_string in INO, format_string
        parsed = protocol.parse_line(example)
        assert parsed is not None and parsed["type"] not in ("invalid", "unknown"), example
    for reply in ('"OK,START"', '"OK,STOP"', '"OK,SIM,ON"', '"OK,SIM,OFF"', '"ERR,RATE,100-1000"', '"ERR,TOO_LONG"'):
        assert reply in INO, reply
    info = re.search(r'"I,(version=%s[^"]*)\\n"', INO)
    assert info is not None
    keys = [part.split("=")[0] for part in info.group(1).split(",")]
    assert keys == ["version", "rate", "mode", "streaming", "pin", "baud", "core", "queue"]


def test_the_commands_the_firmware_understands() -> None:
    body = function_body("static void handleCommand")
    for command in ('"START"', '"STOP"', '"PING"', '"RATE"', '"SIM ON"', '"SIM OFF"', '"INFO"'):
        assert command in body, command
    # Case-insensitive: every character is upper-cased as it arrives.
    assert "toupper" in function_body("static void readCommands")
    # Streaming starts stopped.
    assert "static volatile bool streaming = false;" in INO


def test_the_readme_puts_the_safety_rule_first() -> None:
    readme = (FIRMWARE / "README.md").read_text(encoding="utf-8")
    first = readme.split("\n## ")[0]
    assert "**" in first and "battery" in first.lower() and "unplugged" in first.lower()
    for topic in ("GPIO34", "voltage divider", "flexors", "extensors", "230400", "PING", "SIM ON", "CP210x", "CH340", "BOOT"):
        assert topic in readme, topic
