const BEEP_SECONDS = 0.15;
const BEEP_VOLUME = 0.05;
const BEEP_HZ = 520;

let audioContext: AudioContext | null = null;

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
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const stopAt = audioContext.currentTime + BEEP_SECONDS;
  oscillator.frequency.value = BEEP_HZ;
  gain.gain.setValueAtTime(BEEP_VOLUME, audioContext.currentTime);
  gain.gain.linearRampToValueAtTime(0, stopAt);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(stopAt);
}
