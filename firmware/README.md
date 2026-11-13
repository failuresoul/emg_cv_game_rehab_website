# EMG firmware and hardware guide

> **Electrical safety: whenever electrodes are on a person, the laptop must run on battery, with its charger unplugged.** No part of the circuit may be connected to mains power while it touches skin. The sensor runs on two 9 V batteries; the ESP32 is powered only by the laptop's USB.

MuVi Rehab reads one forearm muscle through an **Advancer Technologies Muscle Sensor V3.0** and an **ESP32 DevKit V1**. The ESP32 measures the sensor's output 500 times a second and sends the numbers to the browser over USB (Web Serial). Only numbers are sent and stored. This is a research prototype, not a medical device.

What the sensor gives: its SIG pin is an **envelope** of the muscle's electrical activity (amplified, rectified and smoothed), not raw EMG.
- **Useful for:** how strongly the muscle is working, when a contraction starts and ends, and how steady it is.
- **Not useful for:** frequency measures such as fatigue spectra.

## What you need

- Advancer Technologies Muscle Sensor V3.0 with its cable and three snap electrodes, plus fresh disposable gel electrodes.
- Two 9 V batteries with snap clips.
- ESP32 DevKit V1 and a USB **data** cable (some cables only charge).
- Two resistors for the voltage divider (for example 20 kΩ and 10 kΩ), a breadboard and jumper wires.
- A multimeter.
- Optional: a Schottky diode (BAT85, 1N5817 or similar) as a clamp.
- Alcohol wipes, and a skin-safe marker.

## 1. Wiring

```
   9 V battery 1             9 V battery 2
   (+)      (-)               (+)      (-)
    |        |                 |        |
    |        +--------+--------+        |
    |                 |                 |
    v                 v                 v
 +-------------------------------------------+
 |  +Vs             GND              -Vs     |  Muscle Sensor V3.0
 |                                           |
 |                  SIG                      |
 +-------------------+-----------------------+
                     |
                  R_top  (e.g. 20 kΩ)
                     |
                     +------------------------------> ESP32 GPIO34
                     |                         (+ optional Schottky to 3V3)
                  R_bottom (e.g. 10 kΩ)
                     |
 Sensor GND ---------+------------------------------> ESP32 GND   (common ground)

                                    ESP32 USB ------> laptop (on battery!)
```

| From | To | Why |
| --- | --- | --- |
| Battery 1 (+) | Sensor **+Vs** | Positive supply (+9 V) |
| Battery 1 (−) **and** battery 2 (+) | Sensor **GND** (the centre pin) | The midpoint of the two batteries is the sensor's ground |
| Battery 2 (−) | Sensor **−Vs** | Negative supply (−9 V) |
| Sensor **SIG** | R_top → GPIO34 | The signal, reduced by the divider |
| GPIO34 | R_bottom → GND | The bottom of the divider |
| Sensor **GND** | ESP32 **GND** | **Common ground**: without it the readings are meaningless |
| ESP32 USB | Laptop | Power for the ESP32, and the data |

**Notes:**
- **GPIO34 is input only** and on ADC1, which works alongside the ESP32's radio; that is why it is used.
- Never connect a battery to the ESP32, and never connect SIG straight to GPIO34. An ESP32 pin is damaged above about 3.6 V, and SIG can reach about 8 V.
- Disconnect the batteries when you finish: the sensor drains them.

## 2. The voltage divider: keep GPIO34 at or below 3.0 V

1. Build the circuit **without** the divider: leave SIG unconnected to the ESP32.
2. Put the electrodes on (section 3), set the multimeter to DC volts, and measure between **SIG** and **sensor GND**.
3. Ask for the **strongest squeeze** possible and note the highest reading: **V_max**.
4. Choose resistors so that

   **R_bottom / (R_top + R_bottom) ≤ 3.0 / V_max**

   Example: with 20 kΩ on top and 10 kΩ at the bottom the ratio is 10 / 30 = 0.33, so 8 V becomes 2.7 V. This suits any V_max up to 9 V.
5. Build the divider and measure **GPIO34 to GND** during the strongest squeeze: it must stay **at or below 3.0 V**.

**Optional clamp.** A Schottky diode from GPIO34 (anode) to the ESP32's **3V3** pin (cathode, the end with the band) keeps the pin below about 3.6 V even if the divider is wrong.

## 3. Electrodes

Each session uses **one** site. The other hand signal stays on the webcam.

| Site | Where | Drives |
| --- | --- | --- |
| **flexors** | **Inner** forearm (palm side), one third of the way from the elbow to the wrist | Grip level (squeezing) |
| **extensors** | **Outer** forearm (back of the hand side), one third of the way from the elbow to the wrist | Hand openness (opening the fingers) |

**Placing them:**
1. Find the muscle: ask the person to make a fist (flexors) or lift the fingers back (extensors), and feel where the muscle bulges most. That is the **muscle belly**.
2. Clean the skin with an alcohol wipe and let it dry. Shave hair if needed. Use fresh gel electrodes.
3. **Mid-muscle electrode** (the snap marked for the middle of the muscle): on the muscle belly.
4. **End-muscle electrode**: 2–3 cm further along the muscle, towards the wrist, in line with the muscle.
5. **Reference electrode**: on the bony point of the elbow, away from the muscle.
6. Take a photo, and mark the spots with a skin-safe marker, so later sessions use the same places.

**Gain.** The sensor has a small gain potentiometer. Start with it in the middle. If a strong squeeze makes the signal hit a flat top (saturation), turn it down a little and measure V_max again.

## 4. Uploading the firmware (Arduino IDE)

The Espressif ESP32 core must be installed (Tools → Board → Boards Manager → "esp32 by Espressif Systems"). The firmware builds with core 2.x and 3.x; Boards Manager shows which you have.

1. Open `firmware/emg_stream/emg_stream.ino` in the Arduino IDE (the folder and file names must match).
2. **Tools → Board → esp32 → ESP32 Dev Module.**
3. **Tools → Port:** the ESP32's COM port. If none appears, see Troubleshooting.
4. **Tools → Upload Speed: 921600.** Use 115200 if uploads fail.
5. Press **Upload** (the arrow). It ends with "Hard resetting via RTS pin...".
6. Open **Tools → Serial Monitor**. Set the speed to **230400 baud** and the line ending to **Newline**. Then type, one at a time:

| You type | You see |
| --- | --- |
| (nothing: press the EN/RESET button) | `I,version=1.0.0,rate=500,mode=ADC,streaming=0,pin=34,baud=230400,core=3.x,queue=512` |
| `PING` | `PONG,1.0.0` |
| `SIM ON` | `OK,SIM,ON` |
| `START` | `OK,START`, then many lines like `E,0,203`, `E,1,198` … and every second `S,499,0,1.0.0,SIM`. The blue LED is on. |
| `STOP` | `OK,STOP`; the E lines stop and the LED goes off |
| `SIM OFF` | `OK,SIM,OFF` (the real sensor from now on) |
| `INFO` | the settings again |

**What the lines mean:**
- `E,<counter>,<millivolts>` is one sample. The counter goes up by one each time, so a jump means samples were lost.
- In simulation, the millivolts stay near 200 and rise to about 1800 for 1.5 s every 4 s.
- With the real sensor, the value rises when the muscle works.
- `S,<counter>,<dropped>,<version>,<ADC|SIM>` is the status line, once a second. `dropped` counts samples the ESP32 could not send in time; it should stay 0.
- `RATE <hz>` changes the rate (100–1000). It is rounded to whole milliseconds, so `RATE 300` gives `OK,RATE,333`.

7. **Close the Serial Monitor before using the browser.** Only one program can use the port at a time.

To check the rate over a minute from Python (close the Serial Monitor first):

```powershell
server\.venv\Scripts\python.exe -m pip install -r analysis\requirements.txt
server\.venv\Scripts\python.exe analysis\tools\serial_rate.py --port COM5 --sim --seconds 10
server\.venv\Scripts\python.exe analysis\tools\serial_rate.py --port COM5
```

Expect about 500 per second, 0 counter gaps, firmware drops 0, and in simulation a minimum near 185 mV and a maximum near 1850 mV.

## 5. Troubleshooting

| Problem | What to do |
| --- | --- |
| **No COM port appears** | Install the USB driver for the ESP32's USB chip: **CP210x** (Silicon Labs) or **CH340** (WCH); the chip name is printed next to the USB socket. Try another cable: many are **charge-only**. Try another USB port. |
| **Upload fails** ("Failed to connect", "Timed out waiting for packet header") | Hold the **BOOT** button when "Connecting...." appears, and release it when the upload starts. Lower the upload speed to 115200. Close the Serial Monitor and the browser tab. |
| **Garbled characters** in the Serial Monitor | Set the speed to **230400**. Garbage straight after a reset is the ESP32's boot message and is normal. |
| **Noisy signal** (jumps when the muscle is relaxed) | Fresh electrodes and clean, dry skin; press the electrodes on firmly. Keep the cable still and away from the laptop's power supply. Check the reference is on bone, and that the **common ground** is connected. The laptop must be on battery. |
| **Flat signal** (no change on squeezing) | Check both batteries (each above about 7 V), the +Vs/GND/−Vs order, the divider, and that SIG reaches GPIO34. Check the mid and end electrodes are on the muscle, not the reference. Turn the gain up a little. In the Serial Monitor, `SIM ON` should still give a changing signal. |
| **Saturation** (a flat top at about 3000 mV during strong squeezes) | Turn the gain down, or make the divider ratio smaller. Then measure GPIO34 again: never above 3.0 V. |
| **`dropped` above 0, or counter gaps** | Close other programs using the port. Use a direct USB port rather than a hub. A rate of 500 Hz is plenty. |

## Files

| File | What it is |
| --- | --- |
| `emg_stream/emg_stream.ino` | The firmware: 500 Hz sampling on core 0, streaming and commands on core 1 |
| `test-lines.txt` | Example lines and how they must be read; the browser and the Python tools are tested against it |
| `../analysis/tools/serial_rate.py` | Measures the real rate, lost samples and signal range over USB |
| `../analysis/tools/emg_protocol.py` | Reads the firmware's lines in Python |
