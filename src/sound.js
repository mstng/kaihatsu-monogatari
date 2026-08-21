// このファイルが何をするか:
// 効果音を Web Audio でその場で合成する。音源ファイルは持たない。
//
// ■ なぜ合成するか
//   依存パッケージゼロで作っているので、音源ファイルも置きたくない。
//   mp3を数個置くだけでリポジトリの性格が変わるし、権利の確認も要る。
//   単純な音なら、波形を合成したほうが軽いし、音程も自由に変えられる。
//
// ■ ルールではないので、ここは純粋関数ではない
//   AudioContext を持つし、鳴らすという副作用そのものが目的。
//   dev.js / company.js からは絶対に呼ばない。呼ぶのは ui.js だけ。

/** 音量の基準。うるさいと感じたらここを下げる */
const MASTER_GAIN = 0.16;

let context = null;
let muted = false;

/**
 * AudioContext は「ユーザーが操作するまで」作れない（ブラウザの制限）。
 * だから最初のクリックで作り、以後は使い回す。
 */
function ensureContext() {
  if (muted) return null;
  if (!context) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  // タブを切り替えると止まることがあるので、鳴らす前に起こす
  if (context.state === 'suspended') context.resume();
  return context;
}

/**
 * 単音を鳴らす。
 * @param {number} freq 周波数(Hz)
 * @param {number} duration 長さ(秒)
 * @param {object} options type=波形 / delay=遅らせる秒数 / gain=音量倍率 / slide=終わりの周波数
 */
function tone(freq, duration, options = {}) {
  const ctx = ensureContext();
  if (!ctx) return;

  const at = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = options.type ?? 'square';
  osc.frequency.setValueAtTime(freq, at);
  if (options.slide) {
    // 上がる音／下がる音は、これだけで表情がつく
    osc.frequency.exponentialRampToValueAtTime(options.slide, at + duration);
  }

  const peak = MASTER_GAIN * (options.gain ?? 1);
  // 立ち上がりを一瞬つけないと「プチッ」というノイズが乗る
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  osc.connect(amp).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

// --- ゲームの出来事に対応する音 ---

/** 作業が1回進んだ。何十回も鳴るので、いちばん軽く短く */
export function playWork() {
  tone(680, 0.05, { type: 'square', gain: 0.5 });
}

/** 大きく跳ねた。作業音より高く、少し伸ばして「特別」だと分からせる */
export function playCritical() {
  tone(880, 0.07, { gain: 0.9 });
  tone(1320, 0.1, { delay: 0.05, gain: 0.8 });
}

/** ボタンを押した */
export function playTap() {
  tone(420, 0.04, { type: 'triangle', gain: 0.7 });
}

/** 案件が完成した。上がっていく3音 */
export function playComplete() {
  tone(523, 0.1, { gain: 0.9 });
  tone(659, 0.1, { delay: 0.1, gain: 0.9 });
  tone(784, 0.22, { delay: 0.2, gain: 1 });
}

/** レベルアップ。完成より短く、しかし気持ちよく上がる */
export function playLevelUp() {
  tone(660, 0.07, { type: 'triangle', gain: 0.9 });
  tone(880, 0.07, { delay: 0.07, type: 'triangle', gain: 0.9 });
  tone(1175, 0.16, { delay: 0.14, type: 'triangle', gain: 1 });
}

/** お金が入った */
export function playCoin() {
  tone(1050, 0.05, { type: 'triangle', gain: 0.8 });
  tone(1400, 0.12, { delay: 0.05, type: 'triangle', gain: 0.8 });
}

/** 減額・赤字。下がる音にすると、聞いただけで悪い知らせだと分かる */
export function playBad() {
  tone(320, 0.28, { type: 'sawtooth', gain: 0.7, slide: 150 });
}

/** 年度末の決算 */
export function playYearEnd() {
  tone(523, 0.12, { gain: 0.9 });
  tone(659, 0.12, { delay: 0.12, gain: 0.9 });
  tone(784, 0.12, { delay: 0.24, gain: 0.9 });
  tone(1047, 0.3, { delay: 0.36, gain: 1 });
}

// --- 消音 ---

export function isMuted() {
  return muted;
}

/** 音を止める／戻す。止めた状態は呼び出し側が覚えておく */
export function setMuted(value) {
  muted = value;
  if (muted && context && context.state === 'running') context.suspend();
}
