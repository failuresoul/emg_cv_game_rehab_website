# EMG hardware test

The first test of the real muscle sensor with MuVi Rehab, step by step. Fill in every **Result** cell as you go; write "—" for anything you skip, and why. The wiring, divider and electrode placement are explained in [firmware/README.md](../firmware/README.md); this document is the checklist and the record.

> **Electrical safety rule.** Whenever electrodes are on a person, **the laptop runs on battery, with its charger unplugged**, and nothing else is plugged into the laptop except the ESP32's USB cable. The sensor runs only on its two 9 V batteries. No part of the circuit touches mains power while it touches skin. If anything gets warm, smells or tingles: take the electrodes off first, then unplug the USB.
>
> **Pin rule.** SIG never goes straight to GPIO34. GPIO34 must stay **at or below 3.0 V** (the ESP32 is damaged above about 3.6 V; SIG can reach about 8 V).

This is a research prototype test on a healthy volunteer (yourself). It is not a clinical test.

## Record

| Item | Value |
| --- | --- |
| Date and time | |
| Tester | |
| Volunteer (initials only) and arm | |
| ESP32 board and COM port | |
| Arduino ESP32 core version (Boards Manager) | |
| Firmware version (from `PING`) | |
| Browser and version (Chrome or Edge) | |
| Divider resistors (R_top / R_bottom) | |
| App commit (`git log -1 --oneline`) | |

## Photos to take

Name each file `day16-<letter>-<what>.jpg` and keep them with this record. **Never photograph a face**; crop to the forearm and the bench.

1. **(a)** The whole bench with the power off: batteries, sensor, breadboard, ESP32, laptop.
2. **(a)** A close-up of the sensor's +Vs / GND / −Vs / SIG connections and the battery snaps.
3. **(a)** The divider on the breadboard, with the resistor colour bands readable.
4. **(b)** The multimeter showing SIG's maximum during the strongest squeeze.
5. **(b)** The multimeter showing the divider's output during the strongest squeeze.
6. **(c)** The Serial Monitor after `PING`, `SIM ON`, `START`, `STOP`.
7. **(d)** The terminal with `serial_rate.py`'s 60 s result.
8. **(e)** `/dev/emg-lab` with a rest period and a squeeze on the trace.
9. **(e, g)** The electrodes on the forearm at the **flexors**, with the skin marks.
10. **(f)** The muscle sensor check with all nine items green.
11. **(g)** The calibration summary (rest, three attempts, MVC).
12. **(h)** Grip and hold in play with the "Muscle sensor" badge.
13. **(h)** The electrodes at the **extensors**.
14. **(i)** The game with the amber dot and the "Muscle sensor paused — using the camera" banner.
15. **(i)** The game after re-plugging, back on "Muscle sensor".
16. **(j)** The gain knob's position, and the laptop's battery indicator (charger unplugged).
17. Afterwards: the admin session page's "Muscle sensor" card with the traces.

## (a) Wiring check, power off

Batteries **unsnapped**, USB **unplugged**.

| Check | Expected | Result |
| --- | --- | --- |
| Battery 1 (+) → sensor +Vs | Connected | |
| Battery 1 (−) and battery 2 (+) → sensor GND (centre pin) | Connected | |
| Battery 2 (−) → sensor −Vs | Connected | |
| SIG → R_top → divider output; divider output → R_bottom → GND | Connected | |
| Divider output **not yet** connected to GPIO34 | Not connected | |
| Common ground: sensor GND to ESP32 GND | Connected | |
| No battery wire touches the ESP32 | None | |
| Each 9 V battery's voltage (multimeter, DC) | Above about 7 V each | B1: ___ V, B2: ___ V |
| Continuity: no short between +Vs, GND and −Vs | No beep | |

## (b) SIG maximum and the divider, before GPIO34

Laptop **on battery**. Snap the batteries on. The ESP32 stays unplugged and GPIO34 unconnected. Put the electrodes on the **flexors** (inner forearm, see the firmware guide), gain knob in the middle.

1. Multimeter on DC volts, black probe on the sensor's **GND**, red probe on **SIG**.
2. Relax for 5 s, then squeeze as hard as you can for 3 s (the meter updates slowly; hold the squeeze). Do it three times.
3. Note the highest reading: **V_max**.
4. Move the red probe to the **divider output** and repeat the three squeezes.
5. The divider output must be **at or below 3.0 V**. Only then connect the divider output to GPIO34.

| Measure | Expected | Result |
| --- | --- | --- |
| SIG at rest | Well below 1 V | |
| SIG maximum (V_max), highest of 3 squeezes | Up to about 8 V | |
| Divider ratio R_bottom / (R_top + R_bottom) | V_max × ratio ≤ 3.0 V | |
| Divider output maximum, highest of 3 squeezes | **≤ 3.0 V** | |
| Divider output connected to GPIO34 (only if the line above passed) | Yes | |

If the divider output is above 3.0 V: **stop**, turn the gain down or use a smaller ratio, and measure again.

## (c) Firmware upload and the Serial Monitor

Upload `firmware/emg_stream/emg_stream.ino` as in the firmware guide (ESP32 Dev Module). Serial Monitor at **230400 baud**, line ending **Newline**.

| You type | Expected | Result |
| --- | --- | --- |
| (press EN/RESET) | `I,version=1.0.0,rate=500,mode=ADC,streaming=0,pin=34,baud=230400,…` | |
| `PING` | `PONG,1.0.0` | |
| `SIM ON` | `OK,SIM,ON` | |
| `START` | `OK,START`, then `E,<counter>,<mV>` lines and `S,…` once a second; blue LED on | |
| `STOP` | `OK,STOP`; lines stop, LED off | |
| `SIM OFF` | `OK,SIM,OFF` | |
| `START`, squeeze, `STOP` (real sensor) | The mV values rise while squeezing | |
| Upload warnings, if any (core 2.x / 3.x) | None that stop the build | |

**Close the Serial Monitor** before (d): only one program can use the port.

## (d) Sampling rate: 500 ± 1 samples/s, no gaps over 60 s

```powershell
server\.venv\Scripts\python.exe -m pip install -r analysis\requirements.txt
server\.venv\Scripts\python.exe analysis\tools\serial_rate.py --port COM5 --sim --seconds 10
server\.venv\Scripts\python.exe analysis\tools\serial_rate.py --port COM5 --seconds 60
```

Replace `COM5` with your port (Device Manager → Ports).

| Run | Expected | Result |
| --- | --- | --- |
| Simulation, 10 s: samples per second | 500 ± 1 | |
| Simulation, 10 s: min and max mV | Near 185 and 1850 | |
| Real sensor, 60 s: samples per second | **500 ± 1** | |
| Real sensor, 60 s: counter gaps | **0** | |
| Real sensor, 60 s: firmware drops (`S` lines) | 0 | |

## (e) The real trace in `/dev/emg-lab`

Start the app (two terminals), then open <http://localhost:5173/dev/emg-lab> in Chrome or Edge:

```powershell
cd server; .venv\Scripts\python.exe -m uvicorn app.main:app --reload
cd web; npm run dev
```

Click **Connect ESP32**, choose the ESP32's port. Relax for 10 s, then squeeze firmly three times.

| Check | Expected | Result |
| --- | --- | --- |
| Rest level (smoothed envelope) | Steady; low hundreds of mV at most | ___ mV |
| Strong squeeze level | Several times the rest level | ___ mV |
| Saturation (flat top at about 3000 mV) | None | |
| Gain adjusted? | If it saturated: turn down, re-measure (b) | |
| Onsets and offsets listed for each squeeze | Yes | |
| Leaving the page closes the port (open the session afterwards without a "port busy" error) | Yes | |

## (f) The muscle sensor check (session, stage B)

Log in as a test patient. On the session setup page, turn on **Use the muscle sensor today**, and continue. In the EMG step, answer the three safety questions (charger unplugged, fresh batteries, electrodes on), choose **flexors**, continue, then **Connect sensor**. Note each item's value as shown.

| # | Item | Pass when | Value | Pass? |
| --- | --- | --- | --- | --- |
| 1 | Browser can connect to the sensor | Chrome or Edge (Web Serial) | | |
| 2 | Sensor connected | The port is open | | |
| 3 | Sensor responding | `PONG` within 2 s | | |
| 4 | Data rate | 490–510 samples/s over 2 s | | |
| 5 | No data gaps | Under 0.5% over 5 s | | |
| 6 | Electrodes in contact | Not a flat line (SD over 2 mV in 1 s) | | |
| 7 | Not saturated | No sample at 3000 mV in 5 s | | |
| 8 | Relaxed signal stable | Over 2 s: SD ≤ 40 mV, mean ≤ 800 mV | | |
| 9 | Muscle responds (test squeeze) | Peak ≥ 3 × relaxed mean, with an onset | | |
| | Items 1–8 green for 2 s, then the squeeze | "Continue to calibration" turns on | | |

## (g) Calibration (stage C)

Follow the screen: rest for 10 s, then three strongest squeezes of 3 s with a 30 s pause between them. If the attempts differ by more than 15%, an extra attempt is asked for.

| Measure | Expected | Result |
| --- | --- | --- |
| Rest mean | Close to the rest level in (e) | ___ mV |
| Rest SD | Small (a few mV to tens of mV) | ___ mV |
| Attempt 1 / 2 / 3 (highest 0.5 s mean) | Similar | ___ / ___ / ___ mV |
| Extra attempt asked for? | Only if spread > 15% | |
| Spread (largest − smallest) / largest | ≤ 15% | ___ % |
| MVC (saved) | ≥ 3 × rest mean | ___ mV |
| Onset threshold (rest mean + 3 SD) | Shown on the summary | ___ mV |
| Saved without an error | Yes | |
| Gain / electrode note entered (gain position) | Yes | |

## (h) Games with the sensor

**Flexors** (same session as (g)). On the plan page, make sure **Grip and hold** and **Reach and squeeze** are among today's games (change the plan if needed), then play them.

| Check | Expected | Result |
| --- | --- | --- |
| Grip and hold: the badge | "Muscle sensor" | |
| Grip and hold: the "Using hand closing…" note | Hidden | |
| Grip and hold: the kite follows squeeze strength, and relaxes | Yes | |
| Grip and hold: holds completed / trials | | ___ / ___ |
| Reach and squeeze: the squeeze at the target uses the sensor | Yes, badge "Muscle sensor" | |
| Reach and squeeze: hits / trials | | ___ / ___ |
| Bloom in this session (if in the plan) | Stays on the camera (openness is not the flexors' signal) | |

**Extensors** (a new calibration). End this session, move the electrodes to the **extensors** (outer forearm), start a **new session**, and calibrate at **extensors** (repeat (f) and (g) briefly). Then play **Bloom**.

| Check | Expected | Result |
| --- | --- | --- |
| Extensors: MVC | ≥ 3 × rest mean | ___ mV |
| Bloom: the badge | "Muscle sensor" | |
| Bloom: opening the fingers opens the flower | Yes | |
| Bloom: successes / trials | | ___ / ___ |
| Grip and hold in this session (if played) | Stays on the camera | |

## (i) Unplugging the USB in a game

During Grip and hold (flexors) or Bloom (extensors):

| Step | Expected | Result |
| --- | --- | --- |
| Unplug the ESP32's USB cable | The dot turns amber; the banner "Muscle sensor paused — using the camera" shows; the badge says "Camera"; the game continues with the webcam | |
| Time until the camera takes over | At once (under 1 s) | ___ s |
| Plug the USB back in | Within about 2 s: badge "Muscle sensor", banner gone, dot green, no click needed | |
| Time until the sensor is back | About 1–2 s | ___ s |
| Lift one electrode off the skin for 3 s, then press it back | Amber and camera while off; back to the sensor when on | |
| The run's trials still saved (admin session page) | Yes; trials with the sensor have traces | |

## (j) Battery state and gain

| Check | Expected | Result |
| --- | --- | --- |
| Laptop on battery (charger unplugged) for the whole test | Yes | |
| Laptop battery at the start / end | | ___ % / ___ % |
| 9 V battery 1 at the end | Above about 7 V | ___ V |
| 9 V battery 2 at the end | Above about 7 V | ___ V |
| Gain knob position (as a clock face, e.g. "12 o'clock") | | |
| Gain changed during the test? From / to | | |

## Afterwards

- **Admin → the session:** the "Muscle sensor" card shows the site, rest, MVC, threshold and the readiness results, and a %MVC trace for each sensor trial with green onset and amber offset lines.
- **Admin → patient → Progress:** "Muscle sensor" trends (MVC, onset latency, relaxation, steadiness) appear after a session with the sensor.
- **Problems:** note them below with the step letter, and what you saw.

| Step | Problem | What was done |
| --- | --- | --- |
| | | |
