// このファイルが何をするか:
// 社員の成長（経験値・レベル・スキル）のルール。純粋関数だけ。
//
// ■ なぜ dev.js と分けたか
//   dev.js は「1本の案件をどう作るか」、company.js は「案件をまたいで何が残るか」。
//   カイロソフト系の面白さは後者に寄っている（1本ごとの出来より、育っていく実感）。
//   混ぜると、案件のバランス調整のたびに育成側まで壊すことになる。

import { nextRandom, pickWeighted } from './rng.js';
import { STATS } from './dev.js';

// --- チューニング定数 ---

/** レベルが1上がるごとに、出る数字が何割増えるか */
export const LEVEL_GAIN = 0.12;

/** 上限。ここを超えると数字がインフレして、相性の妙が見えなくなる */
export const MAX_LEVEL = 20;

/** レベルアップに必要な経験値。レベルが上がるほど重くなる */
export function expToNext(level) {
  return Math.round(60 * Math.pow(1.35, level - 1));
}

/**
 * 案件で稼いだ貢献量を、そのまま経験値にはしない。
 * 生の数字は案件の相性で大きく変わるので、そのまま入れると
 * 「当たりを引いた回だけ一気に育つ」ことになり、育成の判断が薄まる。
 */
export const EXP_RATE = 0.55;

/** レベルアップのたびに、この確率でスキルをひとつ覚える */
export const SKILL_CHANCE = 0.45;

// --- スキル ---
//
// 効果は「宣言」で持たせる。関数を持たせると、
// セーブにも載らずテストもしにくくなるため。

export const SKILLS = [
  {
    id: 'fast',
    name: '速筆',
    emoji: '💨',
    describe: '出る数字が +2',
    effect: { flatGain: 2 },
  },
  {
    id: 'night',
    name: '深夜のひらめき',
    emoji: '🌙',
    describe: 'ときどき大きく跳ねる',
    effect: { critChance: 0.18 },
  },
  {
    id: 'reviewer',
    name: 'レビュー鬼',
    emoji: '🔍',
    describe: '安定性がよく伸びる',
    effect: { biasBoost: { stability: 5 } },
  },
  {
    id: 'aesthetic',
    name: '美意識',
    emoji: '✨',
    describe: 'デザインがよく伸びる',
    effect: { biasBoost: { design: 5 } },
  },
  {
    id: 'listener',
    name: 'ヒアリング上手',
    emoji: '👂',
    describe: '使いやすさがよく伸びる',
    effect: { biasBoost: { usability: 5 } },
  },
  {
    id: 'hacker',
    name: '深掘り',
    emoji: '🛠',
    describe: '技術力がよく伸びる',
    effect: { biasBoost: { tech: 5 } },
  },
  {
    id: 'mentor',
    name: '教え上手',
    emoji: '🤝',
    describe: '同じ案件の仲間の経験値 +40%',
    effect: { mentor: 0.4 },
  },
];

export function findSkill(id) {
  return SKILLS.find((s) => s.id === id);
}

/** その社員が持つスキルの効果を1つにまとめる。work() から使う */
export function skillEffects(staff) {
  const merged = { flatGain: 0, critChance: 0, mentor: 0, biasBoost: {} };
  for (const stat of STATS) merged.biasBoost[stat.key] = 0;

  for (const id of staff.skills ?? []) {
    const skill = findSkill(id);
    if (!skill) continue; // 知らないIDが混ざっても壊さない
    const e = skill.effect;
    merged.flatGain += e.flatGain ?? 0;
    merged.critChance += e.critChance ?? 0;
    merged.mentor += e.mentor ?? 0;
    for (const [key, value] of Object.entries(e.biasBoost ?? {})) {
      merged.biasBoost[key] = (merged.biasBoost[key] ?? 0) + value;
    }
  }
  return merged;
}

/** レベルによる倍率 */
export function levelMultiplier(staff) {
  return 1 + ((staff.level ?? 1) - 1) * LEVEL_GAIN;
}

// --- 案件が終わったときの成長 ---

/**
 * 案件の結果を社員に反映する。
 *
 * 状態は書き換えず、新しい社員一覧と「何が起きたか」を返す。
 * 起きたことを配列で返すのは、画面が順番に演出できるようにするため
 * （レベルアップを1件ずつ出したい）。dev.js の work() と同じ考え方。
 */
export function grow(staffList, contribution, seed) {
  let s = seed >>> 0;
  const events = [];

  // 「教え上手」がいると、同じ案件の全員の経験値が増える。
  // 誰と組ませるかが育成の判断になるようにするための仕掛け
  const mentorBonus = staffList.reduce((sum, m) => sum + skillEffects(m).mentor, 0);

  const grown = staffList.map((staff) => {
    const raw = contribution[staff.id] ?? 0;
    if (raw <= 0) return { ...staff };

    // 自分のぶんの「教え上手」は自分には効かない（自分で自分を教えられない）
    const own = skillEffects(staff).mentor;
    const bonus = Math.max(0, mentorBonus - own);
    const gained = Math.round(raw * EXP_RATE * (1 + bonus));

    let next = { ...staff, exp: (staff.exp ?? 0) + gained, skills: [...(staff.skills ?? [])] };
    events.push({ type: 'exp', staffId: staff.id, amount: gained });

    // レベルアップは一度に複数回起こりうる
    while (next.level < MAX_LEVEL && next.exp >= expToNext(next.level)) {
      next.exp -= expToNext(next.level);
      next.level += 1;
      events.push({ type: 'levelup', staffId: staff.id, level: next.level });

      const roll = nextRandom(s);
      s = roll.seed;
      if (roll.value >= SKILL_CHANCE) continue;

      const learnable = SKILLS.filter((skill) => !next.skills.includes(skill.id));
      if (learnable.length === 0) continue;

      const pickRoll = pickWeighted(
        s,
        learnable.map((skill) => ({ weight: 1, value: skill })),
      );
      s = pickRoll.seed;
      next.skills.push(pickRoll.value.id);
      events.push({ type: 'skill', staffId: staff.id, skill: pickRoll.value });
    }

    return next;
  });

  return { staff: grown, events, seed: s };
}

// --- 会社（資金・時間・雇用） ---
//
// ここまで（段階2まで）は失敗が存在せず、案件を選ぶ理由も無かった。
// 給料という固定費を置くと、はじめて「この依頼を受けるか」に意味が出る。

/**
 * 社員ひとりの月給（万円）。これが固定費になる。
 *
 * 60 で始めたが、報酬に対して安すぎて何をしても黒字になり、
 * 資金が「ただ増える数字」になっていた。人件費が案件報酬の
 * おおよそ半分を占める水準まで上げてある。
 */
export const SALARY_PER_MONTH = 120;

/** 開業資金（万円） */
export const STARTING_FUNDS = 2000;

/** 雇うときの一時金（万円）。以後ずっと月給がかかる */
export const HIRE_COST = 400;

/** はじめから在籍している社員 */
export const FOUNDING_STAFF = ['tanaka', 'sato'];

/** 会計年度の開始月 */
const FISCAL_START_MONTH = 4;

/** セーブの形。変えたら上げる */
export const SAVE_VERSION = 1;

/**
 * 会社をつくる。
 * 社員の実体（レベル・スキル）はここが持ち、案件をまたいで残る。
 */
export function createCompany(staffFactory, seed) {
  return {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    staff: FOUNDING_STAFF.map(staffFactory).filter(Boolean),
    funds: STARTING_FUNDS,
    year: 1,
    month: FISCAL_START_MONTH,
    projects: 0,
    history: [],
    bankrupt: false,
  };
}

/** 毎月かかる人件費 */
export function monthlyCost(company) {
  return company.staff.length * SALARY_PER_MONTH;
}

// --- 相性の記録 ---
//
// 技術が7種になり、ジャンル×技術の組み合わせは21通りになった。
// 全部を記憶に頼らせると、発見が楽しみではなく苦痛になる。
// 一度試した組み合わせは控えておいて、次に選ぶときの手がかりにする。
//
// 記録するのは「試したもの」だけ。試していない組み合わせは伏せたままなので、
// 見つける楽しみ自体は残る。

/** 組み合わせを1つのキーにする */
export function comboKey(genreId, techId) {
  return `${genreId}:${techId}`;
}

/** その組み合わせを過去に試していれば、そのときの相性を返す */
export function recalledAffinity(company, genreId, techId) {
  return company.discovered?.[comboKey(genreId, techId)] ?? null;
}

/** 試した結果を控える。すでに知っていれば何も変わらない */
export function remember(company, genreId, techId, affinity) {
  const key = comboKey(genreId, techId);
  if (company.discovered?.[key] === affinity) return company;
  return { ...company, discovered: { ...(company.discovered ?? {}), [key]: affinity } };
}

/** 「1年目 4月」のような表示用の文字列 */
export function dateLabel(company) {
  return `${company.year}年目 ${company.month}月`;
}

/** 月を進める。会計年度は4月はじまり */
export function advanceMonths(company, months) {
  let year = company.year;
  let month = company.month + months;
  while (month > 12) {
    month -= 12;
    if (month >= FISCAL_START_MONTH || company.month <= 12) year += 1;
  }
  return { ...company, year, month };
}

/**
 * 案件が終わったときの精算。
 *
 * 入金と人件費を同時に処理するのは、プレイヤーに「差引でいくら残ったか」を
 * 一度に見せたいから。別々に出すと、儲かったのかどうかが分からなくなる。
 */
export function settle(company, offer, payout) {
  const cost = monthlyCost(company) * offer.months;
  const funds = company.funds + payout - cost;

  const settled = advanceMonths(
    {
      ...company,
      funds,
      projects: company.projects + 1,
      bankrupt: funds < 0,
      history: [
        ...company.history,
        { client: offer.client, size: offer.size, payout, cost, funds },
      ],
    },
    offer.months,
  );

  return { company: settled, payout, cost, profit: payout - cost };
}

/**
 * その応募者を雇うのにかかる支度金。
 * 素質が高いほど高い。「安いが凡庸」「高いが伸びる」を選ばせるための値段差。
 */
export function hireCost(candidate) {
  return Math.round(HIRE_COST * (candidate?.talent ?? 1));
}

/** 雇えるか。支度金だけでなく、増えたあとの月給ぶんも残るかを見る */
export function canHire(company, candidate) {
  if (company.bankrupt) return false;
  return company.funds >= hireCost(candidate) + SALARY_PER_MONTH;
}

/** 雇う。すでに在籍している人は雇えない */
export function hire(company, candidate) {
  if (!candidate || !canHire(company, candidate)) return company;
  if (company.staff.some((s) => s.id === candidate.id)) return company;

  // 応募者リストから外す。雇ったのに残っていると二重に雇えてしまう
  const applicants = (company.applicants ?? []).filter((a) => a.id !== candidate.id);

  return {
    ...company,
    funds: company.funds - hireCost(candidate),
    staff: [...company.staff, { ...candidate }],
    applicants,
  };
}

// --- 保存 ---
//
// ここまで来ると1回の遊びが1セッションで終わらない。
// 壊れたデータ・古いバージョン・欠損のどれが来ても例外を投げない。

export function serialize(company) {
  return JSON.stringify(company);
}

export function deserialize(text, fallback) {
  if (!text) return fallback;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return fallback;
    if (data.version !== SAVE_VERSION) return fallback;
    if (!Array.isArray(data.staff) || data.staff.length === 0) return fallback;
    return {
      ...fallback,
      ...data,
      // 数値が欠けていたら初期値で埋める。壊れた1項目で全部を捨てない
      funds: Number.isFinite(data.funds) ? data.funds : fallback.funds,
      year: Number.isFinite(data.year) ? data.year : fallback.year,
      month: Number.isFinite(data.month) ? data.month : fallback.month,
      staff: data.staff.map((s) => ({ ...s, skills: Array.isArray(s.skills) ? s.skills : [] })),
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch {
    return fallback;
  }
}
