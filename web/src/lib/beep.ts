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

function playTone(hz: number, seconds: number, delaySeconds = 0): void {
  if (!audioContext || muted) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const startAt = audioContext.currentTime + delaySeconds;
  const stopAt = startAt + seconds;
  oscillator.frequency.value = hz;
  gain.gain.setValueAtTime(BEEP_VOLUME, startAt);
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

/** A gentle rising chime at the end of an exercise. */
export function playChime(): void {
  CHIME_NOTES_HZ.forEach((hz, index) => {
    playTone(hz, CHIME_NOTE_SECONDS, index * CHIME_STEP_SECONDS);
  });
}
