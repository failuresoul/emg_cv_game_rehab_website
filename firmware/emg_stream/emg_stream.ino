/*
  MuVi Rehab: EMG stream firmware
  ESP32 DevKit V1 + Advancer Technologies Muscle Sensor V3.0 (SIG through a voltage divider into
  GPIO34). See firmware/README.md for the wiring, electrode placement and safety rules.

  SAFETY: the laptop must run on battery (charger unplugged) whenever electrodes are on a person.

  What it does
  - A FreeRTOS task on core 0 reads the ADC every 2 ms (500 Hz) and puts {counter, millivolts}
    into a queue. It never prints and never allocates memory.
  - loop() on core 1 empties the queue and prints one line per sample:  E,<counter>,<mv>
    and once per second a status line:              S,<counter>,<dropped>,<version>,<ADC|SIM>
  - After a reset it prints the I line, then streams plotter values at once (PLOT_AT_START), so
    the Serial Monitor and Serial Plotter show the signal immediately. START (the app sends it)
    switches to the protocol below. Serial Monitor / Plotter: 115200 baud, Newline.
    Commands (one per line, any case):
      START        begin streaming (LED on); the counter starts again at 0
      STOP         stop streaming (LED off)
      PING         replies PONG,<version>
      RATE <hz>    sampling rate, 100-1000 (rounded to whole milliseconds; the reply gives it)
      SIM ON|OFF   simulated envelope instead of the ADC (no sensor needed)
      INFO         prints the settings as I,key=value,...
      PLOT ON|OFF  for the Arduino IDE's Serial Plotter (Tools -> Serial Plotter, 115200 baud):
                   streams raw_mV, envelope_mV (50 ms average), saturation_mV and zero as
                   labelled values, 100 points a second, without status lines. START (which
                   the browser sends) and a reset always return to the protocol above.
    Replies: OK,<what>   or   ERR,<why>.

  The sensor's SIG is already an amplified, rectified and smoothed EMG envelope, so plain
  millivolts are all the browser needs.

  Builds on Arduino-ESP32 core 2.x and 3.x (board "ESP32 Dev Module").
*/

#include <Arduino.h>
#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---- Bench switches (change, upload, test; set back to 0 before using the app) ---------------

// 1 (default): after every reset the board streams values at once, like a plain analogRead
//    sketch, so the Serial Monitor shows numbers and Tools -> Serial Plotter draws the signal
//    with nothing to type. The app is unaffected: it ignores these lines and its START switches
//    to the protocol. 0: the board waits silently (status lines only) until START or PLOT ON.
#define PLOT_AT_START 1

// ---- Settings ---------------------------------------------------------------------------------

static const uint8_t EMG_PIN = 34;        // ADC1 channel 6; input only
static const uint32_t SAMPLE_HZ = 500;    // default rate; RATE <hz> changes it
// 115200: reliable on every ESP32 DevKit's USB-serial chip (230400 garbled bytes on the project
// board). The browser (web/src/emg/serial.ts) and analysis/tools/serial_rate.py use the same.
// 500 Hz needs about 7 KB/s of the link's 11.5 KB/s; above about 700 Hz the link cannot keep up
// and the firmware counts the samples it could not send as dropped.
static const uint32_t BAUD = 115200;
static const char FW_VERSION[] = "1.0.0";
static const uint8_t LED_PIN = 2;         // the onboard blue LED: on while streaming

static const uint32_t MIN_HZ = 100;
static const uint32_t MAX_HZ = 1000;
static const UBaseType_t QUEUE_LENGTH = 512;  // about 1 s of samples at 500 Hz
static const uint32_t SAMPLES_PER_LOOP = 64;  // printed per pass, so commands are never starved

// ---- ADC attenuation: the full ~0-3.1 V range --------------------------------------------------
// Core 2.x calls the widest range ADC_11db. Core 3.x is built on ESP-IDF 5, which renamed the
// same setting "12 dB" (ADC_ATTEN_DB_12); both have the value 3.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
#include "hal/adc_types.h"
#define EMG_ATTENUATION ((adc_attenuation_t)ADC_ATTEN_DB_12)
#define EMG_CORE "3.x"
#else
#define EMG_ATTENUATION ADC_11db
#define EMG_CORE "2.x"
#endif

// ---- Shared state -----------------------------------------------------------------------------

struct Sample {
  uint32_t counter;
  uint16_t mv;
};

// The queue's memory is static: nothing is allocated while sampling.
static StaticQueue_t queueControl;
static uint8_t queueStorage[QUEUE_LENGTH * sizeof(Sample)];
static QueueHandle_t sampleQueue = nullptr;
static TaskHandle_t samplerHandle = nullptr;

static volatile bool streaming = false;
static volatile bool simulate = false;
static volatile bool restartRequested = false;  // set by START: the sampler resets its counters
// After START, loop() skips samples until counter 0: one taken just before the restart (with the
// old counter) could otherwise slip out after OK,START and look like a jump backwards.
static bool awaitingFirstSample = false;
static volatile uint32_t periodTicks = 2;       // the sampling period, in FreeRTOS ticks
static volatile uint32_t droppedCount = 0;      // written only by the sampler

// Plot mode (PLOT ON): output for the Arduino IDE's Serial Plotter instead of the browser's
// protocol. Every PLOT_EVERY-th sample is printed as labelled values, with a 50 ms moving average
// (the app's smoothing) and fixed lines at 0 and at the app's saturation level. START (which the
// browser sends) always turns it off, and it is off after every reset.
static const uint32_t PLOT_EVERY = 5;          // 500 Hz / 5 = 100 points a second
static const uint32_t PLOT_SMOOTH = 25;        // 25 samples = 50 ms at 500 Hz
static const uint16_t PLOT_SATURATION_MV = 3000;  // the app's default saturation level

// loop() only
static bool plotMode = false;
static uint16_t plotWindow[PLOT_SMOOTH];
static uint32_t plotSum = 0;
static uint32_t plotFilled = 0;
static uint32_t plotIndex = 0;
static uint32_t lastCounter = 0;
static uint32_t lastStatusMs = 0;
static char commandBuffer[40];
static size_t commandLength = 0;
static bool commandTooLong = false;
static char outBuffer[512];
static size_t outLength = 0;

// ---- Timing -----------------------------------------------------------------------------------
// FreeRTOS on the ESP32 Arduino core ticks at 1000 Hz, so a period is a whole number of
// milliseconds: 500 Hz is exactly 2 ticks; RATE 300 becomes 3 ticks, i.e. 333 Hz.

static uint32_t ticksForRate(uint32_t hz) {
  uint32_t ticks = (configTICK_RATE_HZ + hz / 2) / hz;  // rounded to the nearest tick
  return ticks < 1 ? 1 : ticks;
}

static uint32_t currentRateHz() {
  return configTICK_RATE_HZ / periodTicks;
}

// ---- Sampling (core 0) ------------------------------------------------------------------------

static uint16_t readMillivolts() {
  // Calibrated with the chip's eFuse values; never called from an interrupt.
  uint32_t mv = analogReadMilliVolts(EMG_PIN);
  return (uint16_t)(mv > 65535u ? 65535u : mv);
}

// A realistic envelope without a sensor: a baseline of about 200 mV with small noise and, every
// 4 s, a smooth contraction to about 1800 mV lasting 1.5 s (0.25 s rise, 1 s hold, 0.25 s fall).
static uint16_t simulatedMillivolts(uint32_t counter, uint32_t *seed) {
  static const float kPi = 3.14159265f;
  const uint32_t hz = currentRateHz();
  const uint32_t t = (uint32_t)(((uint64_t)counter * 1000u / hz) % 4000u);  // ms in the cycle

  float shape = 0.0f;
  if (t < 250u) {
    shape = 0.5f - 0.5f * cosf(kPi * (float)t / 250.0f);
  } else if (t < 1250u) {
    shape = 1.0f;
  } else if (t < 1500u) {
    shape = 0.5f + 0.5f * cosf(kPi * (float)(t - 1250u) / 250.0f);
  }

  *seed = *seed * 1664525u + 1013904223u;  // a small linear congruential generator
  const int noise = (int)((*seed >> 16) % 31u) - 15;  // -15 to +15 mV
  const float tremor = 40.0f * shape * sinf(2.0f * kPi * 6.0f * (float)t / 1000.0f);

  float mv = 200.0f + 1600.0f * shape + tremor + (float)noise;
  if (mv < 0.0f) mv = 0.0f;
  if (mv > 3300.0f) mv = 3300.0f;
  return (uint16_t)mv;
}

static void samplerTask(void *parameters) {
  (void)parameters;
  uint32_t counter = 0;
  uint32_t seed = 12345u;
  TickType_t lastWake = xTaskGetTickCount();

  for (;;) {
    vTaskDelayUntil(&lastWake, (TickType_t)periodTicks);

    if (restartRequested) {
      counter = 0;
      droppedCount = 0;
      restartRequested = false;
    }
    if (!streaming) {
      continue;
    }

    Sample sample;
    sample.counter = counter++;
    sample.mv = simulate ? simulatedMillivolts(sample.counter, &seed) : readMillivolts();
    // Never wait: if loop() has fallen behind, count the sample as dropped instead.
    if (xQueueSend(sampleQueue, &sample, 0) != pdTRUE) {
      droppedCount = droppedCount + 1;
    }
  }
}

// ---- Output (core 1) --------------------------------------------------------------------------

static void flushOutput() {
  if (outLength > 0) {
    Serial.write((const uint8_t *)outBuffer, outLength);
    outLength = 0;
  }
}

static void appendLine(const char *line, int length) {
  if (length <= 0) return;
  if (outLength + (size_t)length > sizeof(outBuffer)) flushOutput();
  memcpy(outBuffer + outLength, line, (size_t)length);
  outLength += (size_t)length;
}

static void printLine(const char *text) {
  char line[96];
  int length = snprintf(line, sizeof(line), "%s\n", text);
  if (length >= (int)sizeof(line)) length = (int)sizeof(line) - 1;
  appendLine(line, length);
  flushOutput();
}

static const char *modeName() {
  return simulate ? "SIM" : "ADC";
}

static void printStatus() {
  char line[64];
  int length = snprintf(line, sizeof(line), "S,%lu,%lu,%s,%s\n", (unsigned long)lastCounter,
                        (unsigned long)droppedCount, FW_VERSION, modeName());
  appendLine(line, length);
  flushOutput();
}

static void printInfo() {
  char line[128];
  int length = snprintf(line, sizeof(line),
                        "I,version=%s,rate=%lu,mode=%s,streaming=%d,pin=%u,baud=%lu,core=%s,queue=%u\n",
                        FW_VERSION, (unsigned long)currentRateHz(), modeName(), streaming ? 1 : 0,
                        (unsigned)EMG_PIN, (unsigned long)BAUD, EMG_CORE, (unsigned)QUEUE_LENGTH);
  appendLine(line, length);
  flushOutput();
}

// ---- Commands ---------------------------------------------------------------------------------

static void resetPlot() {
  plotSum = 0;
  plotFilled = 0;
  plotIndex = 0;
}

static void beginStreaming() {
  streaming = false;
  xQueueReset(sampleQueue);  // forget samples from before
  lastCounter = 0;
  restartRequested = true;   // the sampler resets its counter on its next tick
  awaitingFirstSample = true;
  resetPlot();
  streaming = true;
  digitalWrite(LED_PIN, HIGH);
}

static void startStreaming() {
  plotMode = false;  // the browser's protocol
  beginStreaming();
  printLine("OK,START");
}

static void stopStreaming() {
  streaming = false;
  digitalWrite(LED_PIN, LOW);
  printLine("OK,STOP");
}

// One sample in plot mode: the moving average always, a line every PLOT_EVERY samples.
static void plotSample(const Sample &sample) {
  if (plotFilled == PLOT_SMOOTH) plotSum -= plotWindow[plotIndex];
  else plotFilled++;
  plotWindow[plotIndex] = sample.mv;
  plotSum += sample.mv;
  plotIndex = (plotIndex + 1) % PLOT_SMOOTH;
  if (sample.counter % PLOT_EVERY != 0) return;
  char line[80];
  int length = snprintf(line, sizeof(line), "raw_mV:%u,envelope_mV:%lu,saturation_mV:%u,zero:0\n",
                        (unsigned)sample.mv, (unsigned long)(plotSum / plotFilled),
                        (unsigned)PLOT_SATURATION_MV);
  appendLine(line, length);
}

static void handleCommand(char *command) {
  // Trim spaces at both ends (the text is already upper case).
  while (*command == ' ') command++;
  size_t length = strlen(command);
  while (length > 0 && command[length - 1] == ' ') command[--length] = '\0';
  if (length == 0) return;

  if (strcmp(command, "START") == 0) {
    startStreaming();
  } else if (strcmp(command, "STOP") == 0) {
    stopStreaming();
  } else if (strcmp(command, "PING") == 0) {
    char line[32];
    snprintf(line, sizeof(line), "PONG,%s", FW_VERSION);
    printLine(line);
  } else if (strncmp(command, "RATE", 4) == 0 && (command[4] == ' ' || command[4] == '\0')) {
    char *end = nullptr;
    long hz = strtol(command + 4, &end, 10);
    while (end != nullptr && *end == ' ') end++;
    if (end == nullptr || *end != '\0' || hz < (long)MIN_HZ || hz > (long)MAX_HZ) {
      printLine("ERR,RATE,100-1000");
      return;
    }
    periodTicks = ticksForRate((uint32_t)hz);
    char line[32];
    snprintf(line, sizeof(line), "OK,RATE,%lu", (unsigned long)currentRateHz());
    printLine(line);
  } else if (strcmp(command, "SIM ON") == 0) {
    simulate = true;
    printLine("OK,SIM,ON");
  } else if (strcmp(command, "SIM OFF") == 0) {
    simulate = false;
    printLine("OK,SIM,OFF");
  } else if (strcmp(command, "INFO") == 0) {
    printInfo();
  } else if (strcmp(command, "PLOT ON") == 0) {
    // For the Arduino IDE's Serial Plotter: starts streaming as labelled values.
    plotMode = true;
    beginStreaming();
    printLine("OK,PLOT,ON");
  } else if (strcmp(command, "PLOT OFF") == 0) {
    plotMode = false;
    streaming = false;
    digitalWrite(LED_PIN, LOW);
    printLine("OK,PLOT,OFF");
  } else {
    char line[64];
    snprintf(line, sizeof(line), "ERR,UNKNOWN,%s", command);
    printLine(line);
  }
}

static void readCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      commandBuffer[commandLength] = '\0';
      if (commandTooLong) {
        printLine("ERR,TOO_LONG");
      } else {
        handleCommand(commandBuffer);
      }
      commandLength = 0;
      commandTooLong = false;
    } else if (commandLength < sizeof(commandBuffer) - 1) {
      commandBuffer[commandLength++] = (char)toupper((unsigned char)c);
    } else {
      commandTooLong = true;  // the rest of this line is ignored
    }
  }
}

// ---- Arduino ----------------------------------------------------------------------------------

void setup() {
  Serial.begin(BAUD);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(EMG_PIN, EMG_ATTENUATION);
  periodTicks = ticksForRate(SAMPLE_HZ);

  sampleQueue = xQueueCreateStatic(QUEUE_LENGTH, sizeof(Sample), queueStorage, &queueControl);
  // Core 0, just below the highest priority; 4 KB of stack is ample (no printing, no buffers).
  xTaskCreatePinnedToCore(samplerTask, "emg-sampler", 4096, nullptr, configMAX_PRIORITIES - 2,
                          &samplerHandle, 0);

  printInfo();  // tells a terminal (or the browser) what is connected
#if PLOT_AT_START
  plotMode = true;  // the bench switch: draw at once in the Serial Plotter
  beginStreaming();
#endif
}

void loop() {
  Sample sample;
  uint32_t handled = 0;
  while (handled < SAMPLES_PER_LOOP && xQueueReceive(sampleQueue, &sample, 0) == pdTRUE) {
    if (awaitingFirstSample) {
      if (sample.counter != 0) continue;  // from before START
      awaitingFirstSample = false;
    }
    if (plotMode) {
      plotSample(sample);
    } else {
      char line[24];
      int length = snprintf(line, sizeof(line), "E,%lu,%u\n", (unsigned long)sample.counter,
                            (unsigned)sample.mv);
      appendLine(line, length);
    }
    lastCounter = sample.counter;
    handled++;
  }
  flushOutput();

  readCommands();

  // The status line once a second (not while plotting: the plotter would draw it).
  const uint32_t now = millis();
  if (now - lastStatusMs >= 1000u) {
    lastStatusMs = now;
    if (!plotMode) printStatus();
  }

  if (handled == 0) {
    delay(1);  // nothing waiting: let other tasks run
  }
}
