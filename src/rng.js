// このファイルが何をするか:
// 種（seed）から決まった順番で乱数を作る。ゲームのことは何も知らない。
//
// なぜ Math.random を使わないか:
//   1. リロードするたびに結果が変わると「良い結果が出るまでやり直す」遊びが成立してしまう
//   2. 種を固定できないと、同じ状況を再現するテストが書けない
//   3. 種をURLに入れれば「同じプロジェクトで競う」ができる（このゲームのシェア導線）
//
// mulberry32 は32bitの軽い擬似乱数。品質は暗号用途には足りないが、
// ゲームの分岐には十分で、実装が数行で済む。

/**
 * 次の乱数を返す。状態を書き換えず、次の種と値を一緒に返すのがポイント。
 * こうしておくと「この時点の乱数列」をそのまま保存・再現できる。
 *
 * @param {number} seed
 * @returns {{ seed: number, value: number }} value は 0以上1未満
 */
export function nextRandom(seed) {
  // >>> 0 で符号なし32bitに畳む。JavaScript のビット演算は符号付きになるため
  let t = (seed + 0x6d2b79f5) >>> 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return { seed: t, value: ((x ^ (x >>> 14)) >>> 0) / 4294967296 };
}

/** min以上max未満の実数 */
export function randomRange(seed, min, max) {
  const roll = nextRandom(seed);
  return { seed: roll.seed, value: min + roll.value * (max - min) };
}

/** 0以上count未満の整数 */
export function randomInt(seed, count) {
  const roll = nextRandom(seed);
  return { seed: roll.seed, value: Math.floor(roll.value * count) };
}

/** 配列から1つ選ぶ。空配列は null を返す（呼び出し側で落ちないように） */
export function pick(seed, items) {
  if (!items || items.length === 0) return { seed, value: null };
  const roll = randomInt(seed, items.length);
  return { seed: roll.seed, value: items[roll.value] };
}

/**
 * 重みつき抽選。[{ weight, value }] を受け取る。
 * 「たいてい少しズレる、たまに大きく沼る」のような偏った分布を作るのに使う。
 */
export function pickWeighted(seed, entries) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  const roll = randomRange(seed, 0, total);
  let acc = 0;
  for (const entry of entries) {
    acc += entry.weight;
    if (roll.value < acc) return { seed: roll.seed, value: entry.value };
  }
  // 浮動小数の誤差で最後まで届かなかったときの保険
  return { seed: roll.seed, value: entries[entries.length - 1].value };
}

/** 配列をシャッフルした新しい配列を返す（元の配列は書き換えない） */
export function shuffle(seed, items) {
  const result = [...items];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    const roll = randomInt(s, i + 1);
    s = roll.seed;
    [result[i], result[roll.value]] = [result[roll.value], result[i]];
  }
  return { seed: s, value: result };
}
