// このテストが何を守るか:
// 段階1の芯（同じ種なら同じ結果／相性が結果に効く／評価が壊れない）を検証する。
// 手触りの良し悪しはテストでは測れないので、そこは実際に触って判断する。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATS,
  GENRES,
  TECHS,
  STAFF_POOL,
  WORK_COUNT,
  REVIEWER_COUNT,
  MAX_SCORE_PER_REVIEWER,
  startProject,
  work,
  progress,
  totalScore,
  review,
  affinityOf,
  affinityHint,
  findStaff,
} from '../src/dev.js';

const SETUP = { genreId: 'gyomu', techId: 'java', staffIds: ['tanaka', 'sato', 'suzuki'] };

/** 完成まで回す */
function playThrough(setup, seed) {
  let state = startProject(setup, seed);
  while (!state.done) state = work(state);
  return state;
}

// --- 素材 ---

test('4つの指標が定義されている', () => {
  assert.equal(STATS.length, 4);
  for (const stat of STATS) {
    assert.ok(stat.key && stat.label && stat.emoji);
  }
});

test('社員はそれぞれ全指標に重みを持つ（0除算で抽選が壊れない）', () => {
  for (const staff of STAFF_POOL) {
    for (const stat of STATS) {
      assert.ok(staff.bias[stat.key] > 0, `${staff.name} の ${stat.key} の重みがない`);
    }
    assert.ok(
      STATS.some((s) => s.key === staff.specialty),
      `${staff.name} の得意分野が指標にない`,
    );
  }
});

test('すべてのジャンル×技術に相性が定義されている', () => {
  const ranks = ['great', 'good', 'normal', 'bad'];
  for (const genre of GENRES) {
    for (const tech of TECHS) {
      assert.ok(ranks.includes(affinityOf(genre.id, tech.id)), `${genre.id}×${tech.id} が未定義`);
    }
  }
});

test('知らない組み合わせを聞かれても落ちない', () => {
  assert.equal(affinityOf('nothing', 'nowhere'), 'normal');
});

// --- 進行 ---

test('同じ種・同じ選択なら必ず同じ結果になる', () => {
  const a = playThrough(SETUP, 12345);
  const b = playThrough(SETUP, 12345);
  assert.deepEqual(a.stats, b.stats);
  assert.deepEqual(review(a), review(b));
});

test('種が違えば結果も変わる', () => {
  const a = playThrough(SETUP, 1);
  const b = playThrough(SETUP, 2);
  assert.notDeepEqual(a.stats, b.stats);
});

test('決められた回数で完成する', () => {
  let state = startProject(SETUP, 7);
  let steps = 0;
  while (!state.done && steps < 500) {
    state = work(state);
    steps++;
  }
  assert.equal(steps, WORK_COUNT);
  assert.equal(state.worked, WORK_COUNT);
});

test('完成後にさらに作業しても状態は変わらない', () => {
  const done = playThrough(SETUP, 7);
  const snapshot = JSON.stringify(done);
  assert.equal(JSON.stringify(work(done)), snapshot);
});

test('元の状態は書き換わらない（イミュータブル）', () => {
  const state = startProject(SETUP, 7);
  const snapshot = JSON.stringify(state);
  work(state);
  assert.equal(JSON.stringify(state), snapshot);
});

test('1回の作業で必ずどれかの指標が増える', () => {
  let state = startProject(SETUP, 21);
  for (let i = 0; i < 10; i++) {
    const before = totalScore(state);
    state = work(state);
    assert.ok(totalScore(state) > before, '数字が増えていない');
    assert.ok(state.lastWork.gain > 0);
  }
});

test('作業結果には、誰がどの指標を伸ばしたかが入っている（画面がこれを飛ばす）', () => {
  const state = work(startProject(SETUP, 33));
  assert.ok(findStaff(state.lastWork.staffId), '知らない社員IDが入っている');
  assert.ok(STATS.some((s) => s.key === state.lastWork.statKey));
  assert.equal(typeof state.lastWork.critical, 'boolean');
});

test('担当した社員しか作業しない', () => {
  let state = startProject({ ...SETUP, staffIds: ['tanaka'] }, 41);
  for (let i = 0; i < WORK_COUNT; i++) {
    state = work(state);
    assert.equal(state.lastWork.staffId, 'tanaka');
  }
});

test('進み具合は0から1へ進み、1を超えない', () => {
  let state = startProject(SETUP, 51);
  assert.equal(progress(state), 0);
  while (!state.done) state = work(state);
  assert.equal(progress(state), 1);
});

// --- 相性 ---

test('相性が良い組み合わせのほうが、はっきり高い数字になる', () => {
  // これが成立しないと「組み合わせを見つける」遊びが成り立たない
  let great = 0;
  let bad = 0;
  for (let seed = 1; seed <= 60; seed++) {
    // gyomu × java = great / gyomu × ts = bad
    great += totalScore(playThrough({ ...SETUP, techId: 'java' }, seed));
    bad += totalScore(playThrough({ ...SETUP, techId: 'ts' }, seed));
  }
  assert.ok(great > bad * 1.8, `差が小さすぎる: great=${great} bad=${bad}`);
});

test('得意分野を持つ社員は、その指標がいちばん伸びやすい', () => {
  // 佐藤（デザイン得意）だけで作らせる
  let state = startProject({ ...SETUP, staffIds: ['sato'] }, 61);
  while (!state.done) state = work(state);
  const top = STATS.reduce((best, s) => (state.stats[s.key] > state.stats[best.key] ? s : best));
  assert.equal(top.key, 'design');
});

// --- 評価 ---

test('評価は決められた人数ぶん返り、点数は範囲内に収まる', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const result = review(playThrough(SETUP, seed));
    assert.equal(result.reviews.length, REVIEWER_COUNT);
    for (const r of result.reviews) {
      assert.ok(r.score >= 1 && r.score <= MAX_SCORE_PER_REVIEWER, `点が範囲外: ${r.score}`);
      assert.ok(r.comment.length > 0);
    }
    assert.equal(result.maxSum, REVIEWER_COUNT * MAX_SCORE_PER_REVIEWER);
    assert.ok(result.sales > 0);
  }
});

test('満点は簡単には出ない（出たら「次はもっと上」が無くなる）', () => {
  let perfect = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const result = review(playThrough(SETUP, seed));
    if (result.scoreSum === result.maxSum) perfect++;
  }
  assert.ok(perfect < 20, `満点が多すぎる: ${perfect}/100`);
});

test('相性の良い組み合わせのほうが評価も高くなる', () => {
  const sum = (techId) => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      total += review(playThrough({ ...SETUP, techId }, seed)).scoreSum;
    }
    return total;
  };
  assert.ok(sum('java') > sum('ts'), '相性が評価に効いていない');
});

test('相性のヒントは4種類とも言葉が返る', () => {
  for (const rank of ['great', 'good', 'normal', 'bad']) {
    assert.ok(affinityHint(rank).length > 0);
  }
  // 知らない値でも落ちない
  assert.ok(affinityHint('unknown').length > 0);
});
