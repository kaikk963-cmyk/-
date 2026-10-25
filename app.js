'use strict';

// 音声の流れ:
//   マイク → source ─┬→ analyserIn（入力メーター）
//                     └→ gainNode → [limiter → softClip] → analyserOut ─┬→ monitorGain → スピーカー/イヤホン
//                                                            └→ recDest → MediaRecorder（録音）

const STORAGE_KEY = 'mic-volume-settings-v1';
const METER_FLOOR_DB = -60;

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'),
  powerBtn: $('powerBtn'),
  powerLabel: $('powerLabel'),
  error: $('error'),
  gain: $('gain'),
  gainOut: $('gainOut'),
  gainHint: $('gainHint'),
  inBar: $('inBar'),
  inPeak: $('inPeak'),
  inDb: $('inDb'),
  outBar: $('outBar'),
  outPeak: $('outPeak'),
  outDb: $('outDb'),
  clip: $('clip'),
  recBtn: $('recBtn'),
  recTime: $('recTime'),
  recResult: $('recResult'),
  player: $('player'),
  download: $('download'),
  limiter: $('limiter'),
  monitor: $('monitor'),
  agc: $('agc'),
  ns: $('ns'),
  ec: $('ec'),
  device: $('device'),
};

const defaults = { gainDb: 0, limiter: true, monitor: false, agc: false, ns: false, ec: false, deviceId: '' };
const settings = loadSettings();

let ctx = null;
let stream = null;
let source = null;
let gainNode = null;
let limiter = null;
let softClip = null;
let analyserIn = null;
let analyserOut = null;
let monitorGain = null;
let recDest = null;
let recorder = null;
let recChunks = [];
let recStartedAt = 0;
let recUrl = null;
let rafId = 0;
let clipUntil = 0;
const peakHold = { in: METER_FLOOR_DB, out: METER_FLOOR_DB };

// ---------- 設定の保存 ----------

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...defaults, ...saved };
  } catch {
    return { ...defaults };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // プライベートモードなどで保存できなくても動作は続ける
  }
}

// ---------- 表示 ----------

const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

function renderGain() {
  const db = settings.gainDb;
  const mult = dbToGain(db);
  els.gain.value = String(db);
  els.gainOut.textContent = `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
  let label = '元の音量';
  if (db > 0) label = '増幅';
  if (db < 0) label = '減衰';
  els.gainHint.textContent = `×${mult.toFixed(2)}（${label}）`;
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = `status${kind ? ` ${kind}` : ''}`;
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

function dbToPercent(db) {
  if (!isFinite(db)) return 0;
  const clamped = Math.min(0, Math.max(METER_FLOOR_DB, db));
  return ((clamped - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
}

function formatDb(db) {
  return isFinite(db) && db > METER_FLOOR_DB ? `${db.toFixed(1)} dB` : '-∞ dB';
}

// ---------- オーディオ ----------

function audioConstraints() {
  const audio = {
    autoGainControl: settings.agc,
    noiseSuppression: settings.ns,
    echoCancellation: settings.ec,
  };
  if (settings.deviceId) audio.deviceId = { exact: settings.deviceId };
  return { audio, video: false };
}

async function openStream() {
  // 先に古いマイクを閉じる（スマホは同時に2つ開けないことがある）
  if (source) source.disconnect();
  source = null;
  stopTracks();

  let next;
  try {
    next = await navigator.mediaDevices.getUserMedia(audioConstraints());
  } catch (err) {
    // 保存していたマイクが無くなっていたら既定のマイクで再試行
    if (settings.deviceId && err && err.name === 'OverconstrainedError') {
      settings.deviceId = '';
      saveSettings();
      next = await navigator.mediaDevices.getUserMedia(audioConstraints());
    } else {
      throw err;
    }
  }

  stream = next;
  source = ctx.createMediaStreamSource(stream);
  source.connect(analyserIn);
  source.connect(gainNode);

  const track = stream.getAudioTracks()[0];
  if (track) track.addEventListener('ended', () => stop('マイクが切断されました。'));
}

function stopTracks() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

function buildGraph() {
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });

  analyserIn = ctx.createAnalyser();
  analyserIn.fftSize = 2048;

  gainNode = ctx.createGain();
  gainNode.gain.value = dbToGain(settings.gainDb);

  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;

  // コンプレッサーをすり抜けた一瞬のピークも 0dB を超えないように丸める
  softClip = ctx.createWaveShaper();
  softClip.curve = softClipCurve();
  softClip.oversample = '4x';

  analyserOut = ctx.createAnalyser();
  analyserOut.fftSize = 2048;

  monitorGain = ctx.createGain();
  monitorGain.gain.value = settings.monitor ? 1 : 0;

  recDest = ctx.createMediaStreamDestination();

  routeLimiter();
  limiter.connect(softClip);
  softClip.connect(analyserOut);
  analyserOut.connect(monitorGain);
  analyserOut.connect(recDest);
  monitorGain.connect(ctx.destination);
}

function softClipCurve() {
  const n = 4096;
  const knee = 0.8;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    // knee までは素通し、それ以上は 0.98 に向けてなめらかに頭打ち
    const y = a <= knee ? a : knee + (0.98 - knee) * Math.tanh((a - knee) / (0.98 - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function routeLimiter() {
  gainNode.disconnect();
  gainNode.connect(settings.limiter ? limiter : analyserOut);
}

async function start() {
  showError('');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('このブラウザはマイクに対応していません。HTTPS で開いているか確認してください。');
    return;
  }
  els.powerBtn.disabled = true;
  setStatus('起動中…');
  try {
    buildGraph();
    await openStream();
    await ctx.resume();
    await refreshDevices();
    els.powerBtn.setAttribute('aria-pressed', 'true');
    els.powerLabel.textContent = 'マイクを停止';
    els.recBtn.disabled = typeof MediaRecorder === 'undefined';
    setStatus('動作中', 'is-on');
    rafId = requestAnimationFrame(tick);
  } catch (err) {
    await stop();
    showError(describeError(err));
  } finally {
    els.powerBtn.disabled = false;
  }
}

async function stop(message) {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  cancelAnimationFrame(rafId);
  if (source) source.disconnect();
  stopTracks();
  if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {});
  ctx = source = gainNode = limiter = softClip = analyserIn = analyserOut = monitorGain = recDest = null;

  els.powerBtn.setAttribute('aria-pressed', 'false');
  els.powerLabel.textContent = 'マイクを開始';
  els.recBtn.disabled = true;
  setStatus('停止中');
  resetMeters();
  if (typeof message === 'string') showError(message);
}

function describeError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'マイクの使用が許可されていません。ブラウザ（またはスマホの設定）でマイクへのアクセスを許可してください。';
  }
  if (name === 'NotFoundError') return 'マイクが見つかりません。';
  if (name === 'NotReadableError') return '他のアプリがマイクを使用中の可能性があります。';
  return `マイクを開始できませんでした（${(err && err.message) || name || '不明なエラー'}）`;
}

async function refreshDevices() {
  if (!navigator.mediaDevices.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const current = settings.deviceId;
  els.device.textContent = '';
  els.device.append(new Option('既定のマイク', ''));
  devices
    .filter((d) => d.deviceId && d.deviceId !== 'default')
    .forEach((d, i) => els.device.append(new Option(d.label || `マイク ${i + 1}`, d.deviceId)));
  els.device.value = current;
  if (els.device.value !== current) els.device.value = '';
}

// ---------- メーター ----------

const buf = new Float32Array(2048);

function measure(analyser) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sum / buf.length), peak };
}

function drawMeter(key, bar, peakEl, label, level) {
  const rmsDb = gainToDb(level.rms);
  const peakDb = gainToDb(level.peak);
  // ピークは少しずつ下げて、一瞬の大きな音を見やすくする
  peakHold[key] = Math.max(peakDb, peakHold[key] - 0.6);
  bar.style.clipPath = `inset(0 ${100 - dbToPercent(rmsDb)}% 0 0)`;
  peakEl.style.left = `calc(${dbToPercent(peakHold[key])}% - 2px)`;
  peakEl.style.opacity = peakHold[key] > METER_FLOOR_DB ? '0.9' : '0';
  label.textContent = formatDb(rmsDb);
}

function tick(now) {
  if (!ctx) return;
  drawMeter('in', els.inBar, els.inPeak, els.inDb, measure(analyserIn));
  const out = measure(analyserOut);
  drawMeter('out', els.outBar, els.outPeak, els.outDb, out);

  if (out.peak >= 0.99) clipUntil = now + 1000;
  els.clip.hidden = now > clipUntil;

  if (recorder && recorder.state === 'recording') {
    els.recTime.textContent = formatTime((Date.now() - recStartedAt) / 1000);
  }
  rafId = requestAnimationFrame(tick);
}

function resetMeters() {
  peakHold.in = peakHold.out = METER_FLOOR_DB;
  for (const [bar, peak, label] of [
    [els.inBar, els.inPeak, els.inDb],
    [els.outBar, els.outPeak, els.outDb],
  ]) {
    bar.style.clipPath = 'inset(0 100% 0 0)';
    peak.style.opacity = '0';
    label.textContent = '-∞ dB';
  }
  els.clip.hidden = true;
}

// ---------- 録音 ----------

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
}

function extensionFor(mime) {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

function formatTime(sec) {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function startRecording() {
  const mimeType = pickMimeType();
  recorder = new MediaRecorder(recDest.stream, mimeType ? { mimeType } : undefined);
  recChunks = [];
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size) recChunks.push(e.data);
  });
  recorder.addEventListener('stop', () => {
    const type = recorder.mimeType || mimeType || 'audio/webm';
    const blob = new Blob(recChunks, { type });
    if (recUrl) URL.revokeObjectURL(recUrl);
    recUrl = URL.createObjectURL(blob);
    els.player.src = recUrl;
    els.download.href = recUrl;
    els.download.download = `mic-${timestamp()}.${extensionFor(type)}`;
    els.recResult.hidden = false;
    els.recBtn.textContent = '● 録音開始';
    els.recBtn.classList.remove('active');
    if (ctx) setStatus('動作中', 'is-on');
  });
  recorder.start(1000);
  recStartedAt = Date.now();
  els.recTime.textContent = '00:00';
  els.recBtn.textContent = '■ 録音停止';
  els.recBtn.classList.add('active');
  setStatus('録音中', 'is-rec');
}

// ---------- イベント ----------

function setGainDb(db) {
  settings.gainDb = Math.min(24, Math.max(-24, db));
  renderGain();
  saveSettings();
  if (gainNode) gainNode.gain.setTargetAtTime(dbToGain(settings.gainDb), ctx.currentTime, 0.02);
}

els.powerBtn.addEventListener('click', () => (ctx ? stop() : start()));

els.gain.addEventListener('input', () => setGainDb(Number(els.gain.value)));

document.querySelectorAll('[data-gain]').forEach((btn) => {
  btn.addEventListener('click', () => setGainDb(Number(btn.dataset.gain)));
});

els.recBtn.addEventListener('click', () => {
  if (!ctx) return;
  if (recorder && recorder.state === 'recording') recorder.stop();
  else startRecording();
});

els.limiter.addEventListener('change', () => {
  settings.limiter = els.limiter.checked;
  saveSettings();
  if (gainNode) routeLimiter();
});

els.monitor.addEventListener('change', () => {
  settings.monitor = els.monitor.checked;
  saveSettings();
  if (monitorGain) monitorGain.gain.setTargetAtTime(settings.monitor ? 1 : 0, ctx.currentTime, 0.02);
});

// ブラウザ側の音声処理はマイクを開き直さないと反映されない
for (const key of ['agc', 'ns', 'ec']) {
  els[key].addEventListener('change', async () => {
    settings[key] = els[key].checked;
    saveSettings();
    if (ctx) await reopen();
  });
}

els.device.addEventListener('change', async () => {
  settings.deviceId = els.device.value;
  saveSettings();
  if (ctx) await reopen();
});

async function reopen() {
  try {
    await openStream();
    showError('');
  } catch (err) {
    await stop();
    showError(describeError(err));
  }
}

// ---------- 初期化 ----------

els.limiter.checked = settings.limiter;
els.monitor.checked = settings.monitor;
els.agc.checked = settings.agc;
els.ns.checked = settings.ns;
els.ec.checked = settings.ec;
renderGain();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
