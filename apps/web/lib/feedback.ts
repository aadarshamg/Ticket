// Sound and vibration for scan results, so a volunteer can work without watching the screen.

export type Signal = 'ok' | 'error' | 'warn';

let audio: AudioContext | null = null;

/**
 * Browsers only allow sound after the user has tapped something. Call this from a tap
 * (the PIN form's button) so later beeps are allowed to play.
 */
export function primeAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // no audio on this device; vibration and colour still work
  }
}

function tone(frequency: number, startAfter: number, duration: number): void {
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.15;
  oscillator.connect(gain).connect(audio.destination);
  const start = audio.currentTime + startAfter;
  oscillator.start(start);
  oscillator.stop(start + duration);
}

/** One high beep for "admitted"; two low beeps for a refusal; one mid beep for a warning. */
export function signal(kind: Signal): void {
  try {
    if (kind === 'ok') {
      tone(1200, 0, 0.12);
      navigator.vibrate?.(80);
    } else if (kind === 'error') {
      tone(220, 0, 0.18);
      tone(220, 0.26, 0.18);
      navigator.vibrate?.([200, 100, 200]);
    } else {
      tone(520, 0, 0.3);
      navigator.vibrate?.([120, 80, 120]);
    }
  } catch {
    // feedback is a convenience; never let it break a scan
  }
}
