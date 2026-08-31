/** Короткие UI-звуки через Web Audio API (без mp3). */

let ctx = null;
let unlockPromise = null;

function audioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) ctx = new Ctx();
  return ctx;
}

/** Разблокировать AudioContext после жеста пользователя (scroll/touch). */
export function unlockUiSounds() {
  const ac = audioCtx();
  if (!ac) return Promise.resolve(false);
  if (ac.state === "running") return Promise.resolve(true);
  if (!unlockPromise) {
    unlockPromise = ac.resume()
      .then(() => ac.state === "running")
      .catch(() => false)
      .finally(() => { unlockPromise = null; });
  }
  return unlockPromise;
}

/** Щелчок барабана календаря — короткий «ratchet» при смене дня на ±1. */
export async function playCalDrumRatchet() {
  const ac = audioCtx();
  if (!ac) return;
  if (ac.state !== "running") {
    const ok = await unlockUiSounds();
    if (!ok || ac.state !== "running") return;
  }

  const t = ac.currentTime;
  const master = ac.createGain();
  master.gain.value = 0.72;
  master.connect(ac.destination);

  // Удар: короткий шум через bandpass.
  const noiseDur = 0.018;
  const noiseBuf = ac.createBuffer(1, Math.ceil(ac.sampleRate * noiseDur), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 1.6;
  const nGain = ac.createGain();
  nGain.gain.setValueAtTime(0.0001, t);
  nGain.gain.exponentialRampToValueAtTime(0.48, t + 0.001);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t + noiseDur);
  noise.connect(bp);
  bp.connect(nGain);
  nGain.connect(master);
  noise.start(t);
  noise.stop(t + noiseDur + 0.002);

  // Металлический «клац» — быстрый нисходящий тон.
  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(3400, t);
  osc.frequency.exponentialRampToValueAtTime(1100, t + 0.01);
  const oGain = ac.createGain();
  oGain.gain.setValueAtTime(0.0001, t);
  oGain.gain.exponentialRampToValueAtTime(0.18, t + 0.0005);
  oGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
  osc.connect(oGain);
  oGain.connect(master);
  osc.start(t);
  osc.stop(t + 0.016);
}
