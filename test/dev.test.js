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
  createStaff,
  generateOffers,
  generateCandidate,
  talentStars,
  TALENT_RANGE,
  SIZES,
  CONDITIONS,
  findCondition,
  TRAITS,
  findTrait,
} from '../src/dev.js';

/** 社員の実体を作る。startProject は ID ではなく実体を受け取る（レベルとスキルを見るため） */
const team = (...ids) => ids.map(createStaff);

const SETUP = { genreId: 'gyomu', techId: 'java', staff: team('tanaka', 'sato', 'suzuki') };

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
  let state = startProject({ ...SETUP, staff: team('tanaka') }, 41);
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
  let state = startProject({ ...SETUP, staff: team('sato') }, 61);
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

// --- 依頼 ---

test('依頼は指定した件数ぶん来て、規模がばらける', () => {
  const { offers } = generateOffers(1, 3);
  assert.equal(offers.length, 3);
  // 全部同じ大きさだと「どれでもいい」になり、選択が消える
  assert.equal(new Set(offers.map((o) => o.size)).size, 3);
  for (const offer of offers) {
    assert.ok(offer.client && offer.reward > 0 && offer.months > 0);
    assert.ok(offer.teamSize > 0 && offer.workCount > 0);
    assert.ok(GENRES.some((g) => g.id === offer.genreId));
  }
});

test('依頼は同じ種なら同じ内容になる', () => {
  assert.deepEqual(generateOffers(42, 3).offers, generateOffers(42, 3).offers);
});

test('規模が大きいほど、必要人数も期間も報酬も増える', () => {
  const { small, medium, large } = SIZES;
  assert.ok(small.teamSize < medium.teamSize && medium.teamSize < large.teamSize);
  assert.ok(small.months < medium.months && medium.months < large.months);
  assert.ok(small.reward < medium.reward && medium.reward < large.reward);
  assert.ok(small.workCount < medium.workCount && medium.workCount < large.workCount);
});

test('作業回数は依頼の規模ぶんだけ行われる', () => {
  const staff = team('tanaka', 'sato');
  let state = startProject({ ...SETUP, staff, workCount: SIZES.small.workCount }, 5);
  let steps = 0;
  while (!state.done && steps < 200) {
    state = work(state);
    steps++;
  }
  assert.equal(steps, SIZES.small.workCount);
});

// --- 応募者 ---

test('応募者は同じ種なら同じ人が来る', () => {
  assert.deepEqual(generateCandidate(77, 0), generateCandidate(77, 0));
});

test('応募者は種がちがえば別人になる', () => {
  const a = generateCandidate(1, 0);
  const b = generateCandidate(2, 0);
  assert.notEqual(`${a.name}${a.role}${a.talent}`, `${b.name}${b.role}${b.talent}`);
});

test('応募者は素質を持ち、範囲に収まる', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const c = generateCandidate(seed, 0);
    assert.ok(c.talent >= TALENT_RANGE.min && c.talent <= TALENT_RANGE.max, `範囲外: ${c.talent}`);
    assert.equal(c.level, 1);
    assert.deepEqual(c.skills, []);
    assert.ok(STATS.some((s) => s.key === c.specialty));
    for (const stat of STATS) assert.ok(c.bias[stat.key] > 0);
  }
});

test('素質にはばらつきがある（全員同じでは選ぶ意味がない）', () => {
  const talents = new Set();
  for (let seed = 1; seed <= 100; seed++) talents.add(generateCandidate(seed, 0).talent);
  assert.ok(talents.size > 20, `ばらつきが少なすぎる: ${talents.size}種類`);
});

test('素質が高い社員のほうが大きい数字を出す', () => {
  const base = createStaff('tanaka');
  const sum = (talent) => {
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let st = startProject({ ...SETUP, staff: [{ ...base, talent }] }, seed);
      while (!st.done) st = work(st);
      total += totalScore(st);
    }
    return total;
  };
  assert.ok(sum(TALENT_RANGE.max) > sum(TALENT_RANGE.min), '素質が数字に効いていない');
});

test('素質を持たない創業メンバーでも落ちない（1.0として扱う）', () => {
  const staff = team('tanaka');
  assert.equal(staff[0].talent, undefined);
  let st = startProject({ ...SETUP, staff }, 3);
  while (!st.done) st = work(st);
  assert.ok(totalScore(st) > 0);
});

test('素質は★5段階で表され、高いほど星が多い', () => {
  const low = talentStars(TALENT_RANGE.min);
  const high = talentStars(TALENT_RANGE.max);
  assert.equal(low.length, 5);
  assert.equal(high.length, 5);
  assert.ok([...high].filter((c) => c === '★').length > [...low].filter((c) => c === '★').length);
});

// --- 相性表の広がり ---

test('どのジャンルにも「かみ合う」技術がちょうど1つある', () => {
  // 当たりが1つだけだから「見つけた」瞬間がはっきりする
  for (const genre of GENRES) {
    const greats = TECHS.filter((t) => affinityOf(genre.id, t.id) === 'great');
    assert.equal(greats.length, 1, `${genre.name} の当たりが ${greats.length} 個`);
  }
});

test('どのジャンルにも「かみ合わない」技術がある（適当に選ぶと痛い）', () => {
  for (const genre of GENRES) {
    const bads = TECHS.filter((t) => affinityOf(genre.id, t.id) === 'bad');
    assert.ok(bads.length >= 2, `${genre.name} の外れが少なすぎる`);
  }
});

test('組み合わせは記憶に頼るには多い（記録の仕組みが要る根拠）', () => {
  assert.ok(GENRES.length * TECHS.length >= 20);
});

test('どの技術も、どこかのジャンルでは活きる（死に技術を作らない）', () => {
  for (const tech of TECHS) {
    const best = GENRES.map((g) => affinityOf(g.id, tech.id));
    assert.ok(
      best.some((a) => a === 'great' || a === 'good'),
      `${tech.name} が どのジャンルでも活きない`,
    );
  }
});

// --- 依頼の条件 ---

test('条件はすべて名前と説明と効果を持つ', () => {
  for (const [key, cond] of Object.entries(CONDITIONS)) {
    assert.equal(cond.key, key);
    assert.ok(cond.emoji && cond.label && cond.describe);
    assert.ok(cond.rewardMul > 0 && cond.expMul > 0 && cond.pivotMul > 0);
  }
});

test('知らない条件を聞かれても落ちない', () => {
  assert.equal(findCondition('nothing'), null);
  assert.equal(findCondition(null), null);
});

test('条件は一部の依頼にだけ付く（全部に付くと特別感が消える）', () => {
  let withCond = 0;
  let total = 0;
  for (let seed = 1; seed <= 200; seed++) {
    for (const offer of generateOffers(seed, 3).offers) {
      total++;
      if (offer.condition) withCond++;
    }
  }
  const rate = withCond / total;
  assert.ok(rate > 0.3 && rate < 0.8, `条件の出方が偏っている: ${(rate * 100).toFixed(0)}%`);
});

test('特急でも期間が0か月にはならない', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const offer of generateOffers(seed, 3).offers) {
      assert.ok(offer.months >= 1, `期間が ${offer.months} か月になっている`);
    }
  }
});

test('合格ラインを下回ると減額される', () => {
  const cond = CONDITIONS.strict;
  const sz = SIZES.medium;
  const offer = {
    client: 'X', genreId: 'gyomu', size: 'medium', months: sz.months,
    reward: Math.round(sz.reward * cond.rewardMul), teamSize: sz.teamSize,
    workCount: sz.workCount, condition: 'strict',
  };
  const staff = team('tanaka', 'sato', 'suzuki');

  // 相性が最悪の組み合わせなら、合格ラインを割って減額されるはず
  let rejected = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let st = startProject({ genreId: 'gyomu', techId: 'ts', staff, workCount: sz.workCount, offer }, seed);
    while (!st.done) st = work(st);
    if (review(st).rejected) rejected++;
  }
  assert.ok(rejected > 30, `外しても減額されない: ${rejected}/40`);
});

test('条件なしの依頼は減額されない', () => {
  const sz = SIZES.medium;
  const offer = {
    client: 'X', genreId: 'gyomu', size: 'medium', months: sz.months,
    reward: sz.reward, teamSize: sz.teamSize, workCount: sz.workCount, condition: null,
  };
  const staff = team('tanaka', 'sato', 'suzuki');
  let st = startProject({ genreId: 'gyomu', techId: 'ts', staff, workCount: sz.workCount, offer }, 3);
  while (!st.done) st = work(st);
  assert.equal(review(st).rejected, false);
});

test('きびしい客は、当てたときの実入りが条件なしより大きい', () => {
  const sz = SIZES.medium;
  const make = (condition, rewardMul) => ({
    client: 'X', genreId: 'gyomu', size: 'medium', months: sz.months,
    reward: Math.round(sz.reward * rewardMul), teamSize: sz.teamSize,
    workCount: sz.workCount, condition,
  });
  const staff = team('tanaka', 'sato', 'suzuki');
  const total = (offer) => {
    let sum = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let st = startProject({ genreId: 'gyomu', techId: 'java', staff, workCount: sz.workCount, offer }, seed);
      while (!st.done) st = work(st);
      sum += review(st).payout;
    }
    return sum;
  };
  assert.ok(total(make('strict', CONDITIONS.strict.rewardMul)) > total(make(null, 1)));
});

// --- 性格 ---

test('性格はすべて名前と説明と出方の幅を持つ', () => {
  for (const [key, trait] of Object.entries(TRAITS)) {
    assert.equal(trait.key, key);
    assert.ok(trait.emoji && trait.label && trait.describe);
    assert.ok(trait.range.min > 0 && trait.range.max >= trait.range.min);
  }
});

test('知らない性格を聞かれても落ちない', () => {
  assert.equal(findTrait('nothing'), null);
  assert.equal(findTrait(null), null);
});

test('性格はブレ方を変えるが、強さの一軸には潰れない', () => {
  // 平均が大きく離れると「強い性格・弱い性格」になり、選ぶ意味が消える
  const averages = {};
  const spreads = {};
  for (const key of Object.keys(TRAITS)) {
    const staff = { ...createStaff('tanaka'), trait: key };
    let total = 0;
    let count = 0;
    let min = Infinity;
    let max = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let st = startProject({ ...SETUP, staff: [staff] }, seed);
      while (!st.done) {
        st = work(st);
        total += st.lastWork.gain;
        count++;
        min = Math.min(min, st.lastWork.gain);
        max = Math.max(max, st.lastWork.gain);
      }
    }
    averages[key] = total / count;
    spreads[key] = max - min;
  }

  const values = Object.values(averages);
  assert.ok(Math.max(...values) < Math.min(...values) * 1.4, `平均が離れすぎ: ${JSON.stringify(averages)}`);
  // きまじめは狭く、むらっ気は広い
  assert.ok(spreads.steady < spreads.wild, `ブレ方が逆: ${JSON.stringify(spreads)}`);
});

test('つぶやきは出過ぎない', () => {
  const staff = { ...createStaff('tanaka'), trait: 'steady' };
  let count = 0;
  let lines = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let st = startProject({ ...SETUP, staff: [staff] }, seed);
    while (!st.done) {
      st = work(st);
      count++;
      if (st.lastWork.line) lines++;
    }
  }
  const rate = lines / count;
  assert.ok(rate > 0.05 && rate < 0.4, `つぶやきの頻度がおかしい: ${(rate * 100).toFixed(0)}%`);
});

test('性格を持たない社員でも落ちない', () => {
  const staff = { ...createStaff('tanaka'), trait: undefined };
  let st = startProject({ ...SETUP, staff: [staff] }, 3);
  while (!st.done) st = work(st);
  assert.ok(totalScore(st) > 0);
});

test('応募者には性格がつく', () => {
  for (let seed = 1; seed <= 50; seed++) {
    assert.ok(TRAITS[generateCandidate(seed, 0).trait], '知らない性格が振られている');
  }
});
