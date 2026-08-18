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
