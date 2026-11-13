/**
 * Self-contained Web Audio synthesizer + Haptics for Road Trip Party Games
 * Zero audio files required — works 100% offline.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let muted = false;

  try {
    muted = localStorage.getItem('shotgun_muted') === '1';
  } catch (_) {}

  function ensureCtx() {
    if (muted) return null;
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function vibrate(pattern) {
    if (muted) return;
    try {
      if (navigator && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch (_) {}
  }

  function tone(freq, type, startOffset, duration, gainPeak, endFreq) {
    const c = ensureCtx();
    if (!c) return;
    const now = c.currentTime + (startOffset || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.14, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  const SoundFX = {
    isMuted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem('shotgun_muted', muted ? '1' : '0');
      } catch (_) {}
      if (!muted) SoundFX.tap();
      return muted;
    },
    tap() {
      tone(520, 'triangle', 0, 0.055, 0.08, 360);
      vibrate(10);
    },
    pop() {
      tone(420, 'sine', 0, 0.09, 0.12, 760);
      vibrate(14);
    },
    honk() {
      // Classic friendly double car horn ("BEEP-BEEP!")
      tone(440, 'sawtooth', 0, 0.12, 0.09);
      tone(554.37, 'sawtooth', 0, 0.12, 0.08);
      tone(440, 'sawtooth', 0.16, 0.18, 0.10);
      tone(554.37, 'sawtooth', 0.16, 0.18, 0.09);
      vibrate([35, 45, 65]);
    },
    score() {
      tone(523.25, 'triangle', 0, 0.11, 0.13);
      tone(659.25, 'triangle', 0.08, 0.12, 0.13);
      tone(783.99, 'triangle', 0.16, 0.22, 0.15);
      vibrate([20, 30, 30]);
    },
    fanfare() {
      tone(523.25, 'triangle', 0, 0.12, 0.14);
      tone(659.25, 'triangle', 0.10, 0.12, 0.14);
      tone(783.99, 'triangle', 0.20, 0.12, 0.15);
      tone(1046.5, 'triangle', 0.30, 0.38, 0.18);
      vibrate([30, 40, 30, 40, 80]);
    },
    buzz() {
      tone(165, 'sawtooth', 0, 0.22, 0.16, 130);
      tone(155, 'square', 0.18, 0.28, 0.14, 110);
      vibrate([90, 40, 120]);
    },
    tick() {
      tone(880, 'sine', 0, 0.035, 0.06);
    },
    reveal() {
      tone(293.66, 'triangle', 0, 0.14, 0.12, 587.33);
      tone(587.33, 'sine', 0.12, 0.25, 0.14);
      vibrate(25);
    }
  };

  global.SoundFX = SoundFX;
})(typeof window !== 'undefined' ? window : globalThis);
