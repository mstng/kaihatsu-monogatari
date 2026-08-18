// このテストが何を守るか:
// 社員が育つ仕組み（経験値・レベル・スキル）が意図どおり動くこと。
// カイロソフト系の中心は「育つ実感」なので、ここが壊れると作品の芯が消える。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATS, createStaff, startProject, work } from '../src/dev.js';
import {
  SKILLS,
  MAX_LEVEL,
  LEVEL_GAIN,
  expToNext,
  findSkill,
  skillEffects,
  levelMultiplier,
  grow,
} from '../src/company.js';

const team = (...ids) => ids.map(createStaff);

/** 案件を1本まわして、貢献量つきの状態を返す */
function playThrough(staff, seed = 7, techId = 'java') {
  let state = startProject({ genreId: 'gyomu', techId, staff }, seed);
  while (!state.done) state = work(state);
  return state;
}

// --- スキルの定義 ---

test('スキルはすべて名前と説明と効果を持つ', () => {
  assert.ok(SKILLS.length > 0);
  for (const skill of SKILLS) {
    assert.ok(skill.id && skill.name && skill.emoji && skill.describe);
    assert.ok(skill.effect && Object.keys(skill.effect).length > 0, `${skill.name} に効果がない`);
  }
});

test('スキルIDは重複しない', () => {
  const ids = SKILLS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('知らないスキルIDが混ざっても壊れない', () => {
  const effects = skillEffects({ skills: ['nope', 'fast'] });
  assert.equal(effects.flatGain, findSkill('fast').effect.flatGain);
});

test('スキルを持たない社員の効果はすべてゼロ', () => {
  const effects = skillEffects({ skills: [] });
  assert.equal(effects.flatGain, 0);
  assert.equal(effects.critChance, 0);
  assert.equal(effects.mentor, 0);
  for (const stat of STATS) assert.equal(effects.biasBoost[stat.key], 0);
});

test('スキルの効果は重ねて足される', () => {
  const effects = skillEffects({ skills: ['fast', 'night'] });
  assert.equal(effects.flatGain, 2);
  assert.ok(effects.critChance > 0);
});

// --- レベル ---

test('レベル1の倍率は1、上げるほど増える', () => {
  assert.equal(levelMultiplier({ level: 1 }), 1);
  assert.ok(levelMultiplier({ level: 5 }) > levelMultiplier({ level: 2 }));
  // レベル未設定でも落ちない
  assert.equal(levelMultiplier({}), 1);
});

test('レベルアップに必要な経験値は、上がるほど重くなる', () => {
  for (let level = 1; level < 8; level++) {
    assert.ok(expToNext(level + 1) > expToNext(level), `Lv${level} で重くなっていない`);
  }
});

// --- 成長 ---

test('案件に出た社員には経験値が入る', () => {
  const staff = team('tanaka', 'sato');
  const state = playThrough(staff);
  const result = grow(staff, state.contribution, 1);

  for (const member of result.staff) {
    const before = staff.find((s) => s.id === member.id);
    // レベルが上がっていれば exp は繰り越しでリセットされるので、両方を見る
    assert.ok(
      member.level > before.level || member.exp > before.exp,
      `${member.name} が育っていない`,
    );
  }
  assert.ok(result.events.some((e) => e.type === 'exp'));
});

test('案件に出ていない社員は育たない', () => {
  const worked = team('tanaka');
  const bench = createStaff('suzuki');
  const state = playThrough(worked);

  const result = grow([...worked, bench], state.contribution, 1);
  const after = result.staff.find((s) => s.id === 'suzuki');
  assert.equal(after.level, 1);
  assert.equal(after.exp, 0);
});

test('元の社員一覧は書き換わらない（イミュータブル）', () => {
  const staff = team('tanaka', 'sato');
  const snapshot = JSON.stringify(staff);
  const state = playThrough(staff);
  grow(staff, state.contribution, 1);
  assert.equal(JSON.stringify(staff), snapshot);
});

test('経験値が足りればレベルが上がり、上がった記録が残る', () => {
  const staff = team('tanaka');
  // 十分な貢献量を直接与えて、確実にレベルアップさせる
  const result = grow(staff, { tanaka: 5000 }, 1);
  const after = result.staff[0];
  assert.ok(after.level > 1, 'レベルが上がっていない');
  assert.ok(result.events.some((e) => e.type === 'levelup'));
});

test('レベルには上限がある（数字がインフレし続けない）', () => {
  const result = grow(team('tanaka'), { tanaka: 5_000_000 }, 1);
  assert.equal(result.staff[0].level, MAX_LEVEL);
});

test('レベルアップのときにスキルを覚えることがある', () => {
  const result = grow(team('tanaka'), { tanaka: 5000 }, 1);
  const learned = result.events.filter((e) => e.type === 'skill');
  assert.ok(learned.length > 0, 'まったくスキルを覚えていない');
  for (const event of learned) {
    assert.ok(findSkill(event.skill.id), '知らないスキルを覚えている');
  }
});

test('同じスキルを二度覚えない', () => {
  const result = grow(team('tanaka'), { tanaka: 5_000_000 }, 1);
  const skills = result.staff[0].skills;
  assert.equal(new Set(skills).size, skills.length);
});

test('同じ種なら成長も同じ結果になる', () => {
  const a = grow(team('tanaka', 'sato'), { tanaka: 900, sato: 700 }, 42);
  const b = grow(team('tanaka', 'sato'), { tanaka: 900, sato: 700 }, 42);
  assert.deepEqual(a.staff, b.staff);
  assert.deepEqual(a.events, b.events);
});

test('「教え上手」がいると、仲間の経験値が増える', () => {
  const plain = grow(team('tanaka', 'sato'), { tanaka: 500, sato: 500 }, 5);
  const withMentor = grow(
    [createStaff('tanaka'), { ...createStaff('sato'), skills: ['mentor'] }],
    { tanaka: 500, sato: 500 },
    5,
  );
  const expOf = (r, id) => r.events.find((e) => e.type === 'exp' && e.staffId === id).amount;
  assert.ok(expOf(withMentor, 'tanaka') > expOf(plain, 'tanaka'), '仲間の経験値が増えていない');
  // 自分で自分は教えられない
  assert.equal(expOf(withMentor, 'sato'), expOf(plain, 'sato'));
});

// --- 育った社員は実際に強いか ---

test('レベルが高い社員のほうが、案件で大きい数字を出す', () => {
  const novice = createStaff('tanaka');
  const veteran = { ...createStaff('tanaka'), level: 10 };
  const sum = (staff) => {
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = playThrough([staff], seed);
      total += state.contribution[staff.id];
    }
    return total;
  };
  const grownUp = sum(veteran);
  const beginner = sum(novice);
  assert.ok(grownUp > beginner, `育っても強くなっていない: ${beginner} → ${grownUp}`);
  assert.ok(LEVEL_GAIN > 0);
});

test('スキルを持つ社員のほうが、その指標をよく伸ばす', () => {
  const plain = createStaff('tanaka');
  const skilled = { ...createStaff('tanaka'), skills: ['aesthetic'] };
  const designOf = (staff) => {
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) total += playThrough([staff], seed).stats.design;
    return total;
  };
  assert.ok(designOf(skilled) > designOf(plain), 'スキルが指標に効いていない');
});
