const SFX = (() => {
  let enabled = true;
  let audioContext = null;

  function getContext() {
    if (!enabled) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
  }

  function tone(frequency, duration, type = 'square', volume = 0.035, delay = 0) {
    const context = getContext();
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function play(name) {
    if (name === 'reveal-start') {
      tone(220, 0.12, 'sawtooth', 0.025);
      tone(165, 0.16, 'sawtooth', 0.025, 0.13);
    } else if (name === 'wrong') {
      tone(155, 0.18, 'square', 0.04);
      tone(110, 0.24, 'square', 0.035, 0.12);
    } else if (name === 'correct') {
      tone(523, 0.1, 'triangle', 0.045);
      tone(659, 0.1, 'triangle', 0.045, 0.09);
      tone(784, 0.22, 'triangle', 0.05, 0.18);
    } else if (name === 'finish') {
      tone(392, 0.12, 'triangle', 0.04);
      tone(523, 0.12, 'triangle', 0.04, 0.1);
      tone(659, 0.28, 'triangle', 0.05, 0.2);
    }
  }

  function setEnabled(value) { enabled = value; }
  function stop() {
    if (audioContext && audioContext.state !== 'closed') audioContext.suspend();
  }

  return { setEnabled, play, stop };
})();
