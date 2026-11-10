const BEEP_SECONDS = 0.15;
const BEEP_VOLUME = 0.05;
const BEEP_HZ = 520;

const STAR_BASE_HZ = 440;
const STAR_STEP_HZ = 50;
const STAR_SECONDS = 0.18;
const TICK_HZ = 880;
const TICK_SECONDS = 0.06;
const CHIME_NOTES_HZ = [523, 659, 784];
const CHIME_NOTE_SECONDS = 0.28;
const CHIME_STEP_SECONDS = 0.16;

let audioContext: AudioContext | null = null;
let muted = false;

export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

function playTone(hz: number, seconds: number, delaySeconds = 0, volume = BEEP_VOLUME): void {
  if (!audioContext || muted) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const startAt = audioContext.currentTime + delaySeconds;
  const stopAt = startAt + seconds;
  oscillator.frequency.value = hz;
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.linearRampToValueAtTime(0, stopAt);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(stopAt);
}

/** Call from a click: browsers only allow sound after the user has interacted with the page. */
export function prepareAudio(): void {
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
  } catch {
    audioContext = null;
  }
}

/** A soft beep. If sound is unavailable it does nothing, because the countdown is also on screen. */
export function playBeep(): void {
  playTone(BEEP_HZ, BEEP_SECONDS);
}

/** A note that climbs with each star lit. */
export function playStar(starNumber: number): void {
  playTone(STAR_BASE_HZ + starNumber * STAR_STEP_HZ, STAR_SECONDS);
}

/** A short tick for each rep. */
export function playTick(): void {
  playTone(TICK_HZ, TICK_SECONDS);
}

const PLOP_HZ = 196;
const PLOP_SECONDS = 0.12;

/** A soft, low "plop", for something landing gently on the ground. */
export function playPlop(): void {
  playTone(PLOP_HZ, PLOP_SECONDS);
}

/** A gentle rising chime at the end of an exercise. */
export function playChime(): void {
  CHIME_NOTES_HZ.forEach((hz, index) => {
    playTone(hz, CHIME_NOTE_SECONDS, index * CHIME_STEP_SECONDS);
  });
}

/** C, D, E and G: a major pentatonic scale, so any order of notes sounds pleasant together. */
export const PENTATONIC_HZ = [523, 587, 659, 784] as const;
const NOTE_SECONDS = 0.4;
const MUTED_HZ = 165;
const MUTED_SECONDS = 0.08;
const MUTED_VOLUME = 0.02;

/** One note of the pentatonic scale, from 0 (lowest) upwards; wraps after the last. */
export function playNote(index: number): void {
  const notes = PENTATONIC_HZ.length;
  playTone(PENTATONIC_HZ[((Math.floor(index) % notes) + notes) % notes], NOTE_SECONDS);
}

/** A short, quiet, low sound: something did not land, with no "wrong" buzzer. */
export function playMuted(): void {
  playTone(MUTED_HZ, MUTED_SECONDS, 0, MUTED_VOLUME);
}
