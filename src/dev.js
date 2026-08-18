// このファイルが何をするか:
// 開発のルール全部。純粋関数だけで書く。DOM も Date.now() も触らない。
//
// ■ 段階1の主役は「数字が飛ぶ気持ちよさ」
//   だから開発の進行は、まとめて計算せず「1回ぶんの作業」を1つずつ返す形にしてある。
//   画面はそれを受け取ってポンと表示するだけでよく、演出とルールが混ざらない。
//
// ■ 隠しているもの
//   ジャンルと技術の相性（AFFINITY）はプレイヤーに見せない。
//   当たりを引くと数字が跳ねる。それを覚えて次に活かすのがリプレイの動機になる。

import { nextRandom, randomInt, pickWeighted } from './rng.js';

// --- チューニング定数 ---

/** 1案件あたりの作業回数。これが開発シーンの長さになる */
export const WORK_COUNT = 36;

/** 1回の作業で出る基礎の数字 */
export const BASE_GAIN = 3;

/**
 * 相性が良いときの倍率。
 *
 * 最初は great を 2.0 にしていたが、クリティカルが great 限定だったこともあり、
 * 合計が normal の2.7倍（570 対 212）まで開いて評価が40点満点に振り切れていた。
 * 当たりを引いたら気持ちよく、ただし満点は簡単には出ない、に収まる幅へ狭めてある。
 */
export const AFFINITY_BONUS = { great: 1.6, good: 1.3, normal: 1.0, bad: 0.75 };

/** 得意分野を担当したときの倍率 */
export const SPECIALTY_BONUS = 1.6;

/** レビュアーの人数と満点 */
export const REVIEWER_COUNT = 4;
export const MAX_SCORE_PER_REVIEWER = 10;

/**
 * 評価の基準値。4指標の合計がこの値のとき、レビュアーの点が中央（5〜6点）になる。
 * 満点を出にくくして「次はもっと上を狙える」と思わせるための軸。
 */
export const SCORE_PIVOT = 275;

// --- 素材 ---

export const STATS = [
  { key: 'usability', label: '使いやすさ', emoji: '🎯' },
  { key: 'tech', label: '技術力', emoji: '⚙️' },
  { key: 'design', label: 'デザイン', emoji: '🎨' },
  { key: 'stability', label: '安定性', emoji: '🛡' },
];

export const GENRES = [
  { id: 'gyomu', name: '業務システム', emoji: '🏢' },
  { id: 'ec', name: 'ECサイト', emoji: '🛒' },
  { id: 'app', name: 'スマホアプリ', emoji: '📱' },
];

export const TECHS = [
  { id: 'php', name: 'PHP', emoji: '🐘' },
  { id: 'java', name: 'Java', emoji: '☕' },
  { id: 'python', name: 'Python', emoji: '🐍' },
  { id: 'ts', name: 'TypeScript', emoji: '🔷' },
];

/**
 * ジャンル × 技術 の相性。**プレイヤーには見せない。**
 *
 * 見せてしまうと、ただの正解表を読む作業になる。
 * 隠しておいて、遊んだ結果から「あの組み合わせは良かった」と覚えてもらう。
 * これがゲーム発展国の「ジャンル×題材」と同じ仕掛けで、リプレイの動機そのものになる。
 */
const AFFINITY = {
  gyomu: { php: 'good', java: 'great', python: 'normal', ts: 'bad' },
  ec: { php: 'great', java: 'normal', python: 'bad', ts: 'good' },
  app: { php: 'bad', java: 'normal', python: 'good', ts: 'great' },
};

/**
 * 社員。得意分野がばらけているので、誰を入れるかで仕上がりの形が変わる。
 * bias は「どの指標に手が伸びやすいか」の重み。
 */
export const STAFF_POOL = [
  {
    id: 'tanaka',
    name: '田中',
    emoji: '🧑‍💻',
    role: 'バックエンド',
    specialty: 'tech',
    bias: { usability: 2, tech: 6, design: 1, stability: 3 },
  },
  {
    id: 'sato',
    name: '佐藤',
    emoji: '👩‍🎨',
    role: 'フロントエンド',
    specialty: 'design',
    bias: { usability: 4, tech: 2, design: 6, stability: 1 },
  },
  {
    id: 'suzuki',
    name: '鈴木',
    emoji: '🧑‍🔧',
    role: 'インフラ',
    specialty: 'stability',
    bias: { usability: 1, tech: 3, design: 1, stability: 6 },
  },
  {
    id: 'takahashi',
    name: '高橋',
    emoji: '🧑‍💼',
    role: 'ディレクター',
    specialty: 'usability',
    bias: { usability: 6, tech: 2, design: 3, stability: 2 },
  },
];

export function findStaff(id) {
  return STAFF_POOL.find((s) => s.id === id);
}

export function findGenre(id) {
  return GENRES.find((g) => g.id === id);
}

export function findTech(id) {
  return TECHS.find((t) => t.id === id);
}

/** 相性のランク。UIからは結果画面でしか呼ばない */
export function affinityOf(genreId, techId) {
  return AFFINITY[genreId]?.[techId] ?? 'normal';
}

// --- 案件をはじめる ---

/**
 * 開発を開始した状態を作る。
 * 同じ種・同じ選択なら必ず同じ結果になる（やり直しで結果が変わらない）。
 */
export function startProject({ genreId, techId, staffIds }, seed) {
  return {
    seed: seed >>> 0,
    initialSeed: seed >>> 0,
    genreId,
    techId,
    staffIds: [...staffIds],
    // 4指標の積み上げ
    stats: Object.fromEntries(STATS.map((s) => [s.key, 0])),
    // 何回作業したか
    worked: 0,
    // 直近の作業結果（画面がこれをポップさせる）
    lastWork: null,
    done: false,
  };
}

// --- 1回ぶんの作業 ---

/**
 * 作業を1回進める。
 *
 * まとめて計算せず1回ずつ返すのは、画面が「ポンと数字を出す」演出をしやすくするため。
 * ここを一括計算にすると、演出のために UI 側でルールを再現する羽目になる。
 */
export function work(state) {
  if (state.done) return state;

  let s = state.seed;

  // 誰が動くか
  const staffRoll = randomInt(s, state.staffIds.length);
  s = staffRoll.seed;
  const staff = findStaff(state.staffIds[staffRoll.value]);

  // その人がどの指標に手を伸ばすか（bias の重みで抽選）
  const statRoll = pickWeighted(
    s,
    STATS.map((stat) => ({ weight: staff.bias[stat.key], value: stat })),
  );
  s = statRoll.seed;
  const stat = statRoll.value;

  // 数字を決める。ゆらぎ ×（得意なら加算）×（相性）
  const wobble = nextRandom(s);
  s = wobble.seed;

  const affinity = affinityOf(state.genreId, state.techId);
  let gain = BASE_GAIN + Math.floor(wobble.value * 4); // 3〜6
  if (staff.specialty === stat.key) gain = Math.round(gain * SPECIALTY_BONUS);
  gain = Math.round(gain * AFFINITY_BONUS[affinity]);

  // 相性が良いほど、大きい数字が出る回数が増える。
  // 「なんか今回よく跳ねる」と体で分かるのが狙いで、数値表を見せるより伝わる。
  //
  // great だけに出していたときは、倍率とクリティカルが二重にかかって
  // 合計が振り切れた。good にも出して、跳ね幅自体は控えめにしてある。
  const critical = (affinity === 'great' || affinity === 'good') && wobble.value > 0.8;
  if (critical) gain = Math.round(gain * 1.5);

  const worked = state.worked + 1;

  return {
    ...state,
    seed: s,
    stats: { ...state.stats, [stat.key]: state.stats[stat.key] + gain },
    worked,
    lastWork: { staffId: staff.id, statKey: stat.key, gain, critical },
    done: worked >= WORK_COUNT,
  };
}

/** 進み具合（0〜1）。画面のゲージに使う */
export function progress(state) {
  return Math.min(1, state.worked / WORK_COUNT);
}

export function totalScore(state) {
  return STATS.reduce((sum, stat) => sum + state.stats[stat.key], 0);
}

// --- 評価 ---

const REVIEWER_NAMES = ['レビュアーA', 'レビュアーB', 'レビュアーC', 'レビュアーD'];

/**
 * レビュアーのコメント。点数だけだと味気ないので、
 * 「何が良かったのか」が伝わる言葉を返す。
 */
function comment(score, topStat) {
  if (score >= 9) return `${topStat.label}が ずば抜けている`;
  if (score >= 7) return `${topStat.label}が良い`;
  if (score >= 5) return 'よくある感じ';
  if (score >= 3) return 'もう一歩ほしい';
  return '手が回っていない';
}

/**
 * 完成した案件を評価する。
 *
 * 満点を出にくくしているのは、「次はもっと上を狙える」と思わせるため。
 * 初回から満点が出ると、そこで遊びが終わる。
 */
export function review(state) {
  const total = totalScore(state);

  // いちばん伸びた指標。コメントに使う
  const topStat = STATS.reduce((best, stat) =>
    state.stats[stat.key] > state.stats[best.key] ? stat : best,
  );

  let s = state.seed;
  const reviews = [];
  for (let i = 0; i < REVIEWER_COUNT; i++) {
    const roll = nextRandom(s);
    s = roll.seed;
    // 基準値との比で決め、レビュアーごとに ±1.5 のばらつきを乗せる
    const base = (total / SCORE_PIVOT) * 6;
    const score = Math.max(
      1,
      Math.min(MAX_SCORE_PER_REVIEWER, Math.round(base + (roll.value - 0.5) * 3)),
    );
    reviews.push({ name: REVIEWER_NAMES[i], score, comment: comment(score, topStat) });
  }

  const scoreSum = reviews.reduce((sum, r) => sum + r.score, 0);
  const maxSum = REVIEWER_COUNT * MAX_SCORE_PER_REVIEWER;

  // 売上。評価が高いほど伸びる。段階1では結果を実感させるためだけに使う
  const sales = Math.round(total * 3 * (0.5 + scoreSum / maxSum));

  return {
    total,
    topStat,
    reviews,
    scoreSum,
    maxSum,
    sales,
    affinity: affinityOf(state.genreId, state.techId),
    hit: scoreSum >= maxSum * 0.75,
  };
}

/** 結果画面で出す、相性のヒント。次に活きる知識として渡す */
export function affinityHint(affinity) {
  switch (affinity) {
    case 'great':
      return 'この組み合わせは かみ合っていた';
    case 'good':
      return 'この組み合わせは わるくなかった';
    case 'bad':
      return 'この組み合わせは かみ合わなかった';
    default:
      return 'この組み合わせは ふつうだった';
  }
}
