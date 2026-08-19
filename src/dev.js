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
import { skillEffects, levelMultiplier } from './company.js';

// --- チューニング定数 ---

/** 案件の規模。作業回数・報酬・かかる月数が変わる */
/**
 * 案件の規模。
 *
 * teamSize（必要人数）が肝。これが無いと、社員を雇うほど人件費だけ増えて
 * 出来高は変わらず、雇用が常に損になる。大きい案件を受けるには人が要る、
 * という形にして初めて「雇う」が投資になる。
 *
 * 報酬は「人件費のおよそ2倍」を目安に置いてある。
 * 評価が低いと赤字、高いと大きく黒字、という幅を作るため。
 */
export const SIZES = {
  small: { key: 'small', label: '小口', workCount: 22, months: 2, teamSize: 2, reward: 900 },
  medium: { key: 'medium', label: '中堅', workCount: 36, months: 3, teamSize: 3, reward: 1800 },
  large: { key: 'large', label: '大型', workCount: 54, months: 5, teamSize: 4, reward: 4800 },
};

/** 規模を指定しなかったときの作業回数（既定は中堅ぶん） */
export const WORK_COUNT = SIZES.medium.workCount;

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
  { id: 'go', name: 'Go', emoji: '🐹' },
  { id: 'ruby', name: 'Ruby', emoji: '💎' },
  { id: 'kotlin', name: 'Kotlin', emoji: '🟣' },
];

/**
 * ジャンル × 技術 の相性。**プレイヤーには見せない。**
 *
 * 見せてしまうと、ただの正解表を読む作業になる。
 * 隠しておいて、遊んだ結果から「あの組み合わせは良かった」と覚えてもらう。
 * これがゲーム発展国の「ジャンル×題材」と同じ仕掛けで、リプレイの動機そのものになる。
 */
// どのジャンルも「かみ合う1つ・わるくない2つ・ふつう2つ・かみ合わない2つ」で揃えてある。
// 当たりが1つだけだと「見つけた」瞬間がはっきりし、
// 外れも2つあるので、適当に選ぶと痛い目を見る。
const AFFINITY = {
  gyomu: {
    java: 'great',
    php: 'good',
    // Python はここが見せ場。業務系の集計・自動化と噛み合う。
    // 最初は全ジャンルで normal 以下にしてしまい、選ぶ理由のない
    // 「死に技術」になっていた（テストで発覚）
    python: 'good',
    kotlin: 'normal',
    go: 'normal',
    ts: 'bad',
    ruby: 'bad',
  },
  ec: {
    php: 'great',
    ruby: 'good',
    ts: 'good',
    java: 'normal',
    go: 'normal',
    python: 'bad',
    kotlin: 'bad',
  },
  app: {
    ts: 'great',
    kotlin: 'good',
    go: 'good',
    python: 'normal',
    java: 'normal',
    php: 'bad',
    ruby: 'bad',
  },
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

/**
 * 社員を1人つくる。レベル1・経験値0・スキルなしから始まる。
 * STAFF_POOL は定義（素質）で、こちらが実体。育つのは実体のほう。
 */
export function createStaff(id) {
  const def = STAFF_POOL.find((s) => s.id === id);
  if (!def) return null;
  return { ...def, level: 1, exp: 0, skills: [] };
}

export function findStaff(id) {
  return STAFF_POOL.find((s) => s.id === id);
}

// --- 応募者 ---
//
// 固定の4人を順に雇うだけだと、採用が「図鑑を埋める作業」になり判断が消える。
// 毎回ちがう人が応募してくる形にして、はじめて「この人を採るか」に意味が出る。

/**
 * 素質。出る数字にそのまま掛かる。
 * 幅を持たせることで「安いが凡庸」「高いが伸びる」の選択が生まれる。
 */
export const TALENT_RANGE = { min: 0.8, max: 1.35 };

const FAMILY_NAMES = [
  '伊藤', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木',
  '松本', '井上', '木村', '林', '清水', '山崎', '池田', '橋本',
];

/** 職種のひな形。得意分野と、手の伸びやすさの傾向を決める */
const ARCHETYPES = [
  { role: 'バックエンド', emoji: '🧑‍💻', specialty: 'tech', bias: { usability: 2, tech: 6, design: 1, stability: 3 } },
  { role: 'フロントエンド', emoji: '👩‍🎨', specialty: 'design', bias: { usability: 4, tech: 2, design: 6, stability: 1 } },
  { role: 'インフラ', emoji: '🧑‍🔧', specialty: 'stability', bias: { usability: 1, tech: 3, design: 1, stability: 6 } },
  { role: 'ディレクター', emoji: '🧑‍💼', specialty: 'usability', bias: { usability: 6, tech: 2, design: 3, stability: 2 } },
  { role: 'なんでも屋', emoji: '🧑‍🚀', specialty: 'tech', bias: { usability: 3, tech: 3, design: 3, stability: 3 } },
];

/**
 * 応募者を作る。同じ種なら同じ人が来る。
 * index は「同時に来た何人目か」で、種をずらすためだけに使う。
 */
export function generateCandidate(seed, index = 0) {
  let s = (seed + index * 7919) >>> 0;

  const nameRoll = randomInt(s, FAMILY_NAMES.length);
  s = nameRoll.seed;
  const typeRoll = randomInt(s, ARCHETYPES.length);
  s = typeRoll.seed;
  const talentRoll = nextRandom(s);
  s = talentRoll.seed;

  const archetype = ARCHETYPES[typeRoll.value];
  const talent =
    Math.round((TALENT_RANGE.min + talentRoll.value * (TALENT_RANGE.max - TALENT_RANGE.min)) * 100) /
    100;

  return {
    // 同じ人を二度雇わないよう、名前と職種から決まるIDにする
    id: `hire-${nameRoll.value}-${typeRoll.value}`,
    name: FAMILY_NAMES[nameRoll.value],
    emoji: archetype.emoji,
    role: archetype.role,
    specialty: archetype.specialty,
    bias: { ...archetype.bias },
    talent,
    level: 1,
    exp: 0,
    skills: [],
    seed: s,
  };
}

/** 素質を★で表す。数値をそのまま見せるより、ひと目で比べられる */
export function talentStars(talent) {
  const span = TALENT_RANGE.max - TALENT_RANGE.min;
  const ratio = (talent - TALENT_RANGE.min) / span;
  const filled = Math.max(1, Math.min(5, Math.round(ratio * 4) + 1));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
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

/** 依頼元。実在の企業と紛らわしくならない、それっぽい架空の名前にする */
const CLIENTS = [
  'さくら商事',
  'あおば銀行',
  'みらい物流',
  'ひので製菓',
  'かなで出版',
  'つばさ観光',
  'こもれび不動産',
  'はやて運輸',
  'なぎさ水産',
  'あかつき電機',
];

// --- 依頼が来る ---

/**
 * 依頼を何件か作る。プレイヤーはここから1件選ぶ。
 *
 * 選ばせることが目的なので、規模は必ずばらけさせる。
 * 全部同じ大きさだと「どれでもいい」になり、選択が消える。
 */
export function generateOffers(seed, count = 3) {
  let s = seed >>> 0;
  const sizes = Object.values(SIZES);
  const offers = [];

  for (let i = 0; i < count; i++) {
    const size = sizes[i % sizes.length];

    const genreRoll = randomInt(s, GENRES.length);
    s = genreRoll.seed;
    const clientRoll = randomInt(s, CLIENTS.length);
    s = clientRoll.seed;
    const rewardRoll = nextRandom(s);
    s = rewardRoll.seed;

    offers.push({
      id: `offer${i}`,
      client: CLIENTS[clientRoll.value],
      genreId: GENRES[genreRoll.value].id,
      size: size.key,
      label: size.label,
      workCount: size.workCount,
      months: size.months,
      teamSize: size.teamSize,
      // 報酬は ±15% ゆらす。同じ規模でも当たり外れが出るように
      reward: Math.round(size.reward * (0.85 + rewardRoll.value * 0.3)),
    });
  }

  return { offers, seed: s };
}

// --- 案件をはじめる ---

/**
 * 開発を開始した状態を作る。
 * 同じ種・同じ選択なら必ず同じ結果になる（やり直しで結果が変わらない）。
 */
export function startProject({ genreId, techId, staff, workCount, offer }, seed) {
  return {
    seed: seed >>> 0,
    initialSeed: seed >>> 0,
    genreId,
    techId,
    // 規模によって作業回数が変わる。指定がなければ中堅ぶん
    workCount: workCount ?? WORK_COUNT,
    // どの依頼を受けたか。報酬の計算に使う
    offer: offer ?? null,
    // 社員は「実体」を受け取る。レベルやスキルを work() が見るため、
    // IDだけ渡す形だと成長が結果に反映されない
    staff: staff.map((s) => ({ ...s })),
    // 誰がどれだけ数字を出したか。案件のあと、これが経験値になる
    contribution: Object.fromEntries(staff.map((s) => [s.id, 0])),
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
  const staffRoll = randomInt(s, state.staff.length);
  s = staffRoll.seed;
  const staff = state.staff[staffRoll.value];
  const skills = skillEffects(staff);

  // その人がどの指標に手を伸ばすか（bias の重みで抽選）。
  // スキルはこの「手の伸びやすさ」を押し上げる形で効かせる。
  // 数字そのものを増やすより、その人らしさが出る
  const statRoll = pickWeighted(
    s,
    STATS.map((stat) => ({
      weight: staff.bias[stat.key] + (skills.biasBoost[stat.key] ?? 0),
      value: stat,
    })),
  );
  s = statRoll.seed;
  const stat = statRoll.value;

  // 数字を決める。ゆらぎ ＋スキル ×（得意）×（レベル）×（相性）
  const wobble = nextRandom(s);
  s = wobble.seed;

  const affinity = affinityOf(state.genreId, state.techId);
  let gain = BASE_GAIN + Math.floor(wobble.value * 4) + skills.flatGain; // 3〜6 ＋スキル
  if (staff.specialty === stat.key) gain = Math.round(gain * SPECIALTY_BONUS);
  // 素質。応募者ごとに違う。既存の創業メンバーは 1.0 として扱う
  gain = Math.round(gain * (staff.talent ?? 1));
  gain = Math.round(gain * levelMultiplier(staff));
  gain = Math.round(gain * AFFINITY_BONUS[affinity]);

  // 相性が良いほど、大きい数字が出る回数が増える。
  // 「なんか今回よく跳ねる」と体で分かるのが狙いで、数値表を見せるより伝わる。
  //
  // great だけに出していたときは、倍率とクリティカルが二重にかかって
  // 合計が振り切れた。good にも出して、跳ね幅自体は控えめにしてある。
  // スキル「深夜のひらめき」は、相性に関係なく跳ねる目を足す
  const baseCrit = affinity === 'great' || affinity === 'good' ? 0.2 : 0;
  const critical = wobble.value > 1 - (baseCrit + skills.critChance);
  if (critical) gain = Math.round(gain * 1.5);

  const worked = state.worked + 1;

  return {
    ...state,
    seed: s,
    stats: { ...state.stats, [stat.key]: state.stats[stat.key] + gain },
    // 誰がどれだけ出したかを積む。これが案件のあとの経験値になる
    contribution: {
      ...state.contribution,
      [staff.id]: (state.contribution[staff.id] ?? 0) + gain,
    },
    worked,
    lastWork: { staffId: staff.id, statKey: stat.key, gain, critical },
    done: worked >= state.workCount,
  };
}

/** 進み具合（0〜1）。画面のゲージに使う */
export function progress(state) {
  return Math.min(1, state.worked / state.workCount);
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

  // 基準は作業回数に比例させる。固定にすると、
  // 作業回数の多い大型案件が自動的に高評価になってしまう
  const pivot = SCORE_PIVOT * (state.workCount / WORK_COUNT);

  let s = state.seed;
  const reviews = [];
  for (let i = 0; i < REVIEWER_COUNT; i++) {
    const roll = nextRandom(s);
    s = roll.seed;
    // 基準値との比で決め、レビュアーごとに ±1.5 のばらつきを乗せる
    const base = (total / pivot) * 6;
    const score = Math.max(
      1,
      Math.min(MAX_SCORE_PER_REVIEWER, Math.round(base + (roll.value - 0.5) * 3)),
    );
    reviews.push({ name: REVIEWER_NAMES[i], score, comment: comment(score, topStat) });
  }

  const scoreSum = reviews.reduce((sum, r) => sum + r.score, 0);
  const maxSum = REVIEWER_COUNT * MAX_SCORE_PER_REVIEWER;

  // 入金。依頼の報酬を土台に、評価で増減する。
  //
  // 下限を 0.1 と低く置いているのは、評価が低いと赤字になるようにするため。
  // 下限が人件費を上回っていると、何をしても黒字になり、資金に意味が無くなる
  // （最初は 0.6 にしていて、どんな作り方をしても儲かる状態になっていた）。
  const payout = state.offer
    ? Math.round(state.offer.reward * (0.1 + (scoreSum / maxSum) * 1.0))
    : Math.round(total * 3 * (0.5 + scoreSum / maxSum));

  return {
    total,
    topStat,
    reviews,
    scoreSum,
    maxSum,
    sales: payout,
    payout,
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
