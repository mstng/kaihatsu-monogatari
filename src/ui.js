// このファイルが何をするか:
// 画面の描画と演出。ゲームのルールは一切書かない（全部 src/dev.js と src/company.js にある）。
//
// ■ 段階1で効いた構造を、段階3でも崩さない
//   1. 待たされない（190msごとに何かが起きる）
//   2. 手を離しても進む（開発中は眺めるだけ）
//   3. 判断は前に置く（依頼・技術・人選を決めたら、あとは眺める）
//   「決める時間」と「眺める時間」が分かれているのがカイロソフト系の構造で、
//   ここが混ざると PMシム（mitsumori）と同じ「ずっと考えさせられる」画面になる。

import {
  STATS,
  TECHS,
  SIZES,
  startProject,
  work,
  progress,
  review,
  affinityHint,
  findGenre,
  findTech,
  createStaff,
  generateOffers,
  generateCandidate,
  talentStars,
  findCondition,
} from './dev.js';
import {
  grow,
  expToNext,
  findSkill,
  MAX_LEVEL,
  SALARY_PER_MONTH,
  hireCost,
  remember,
  recalledAffinity,
  createCompany,
  monthlyCost,
  dateLabel,
  settle,
  canHire,
  hire,
  serialize,
  deserialize,
  yearSummary,
  closeYear,
} from './company.js';

// --- 演出のつまみ（手触りはここで変わる） ---

/** 1回の作業の間隔(ms)。短いほど気持ちいいが、速すぎると何が起きたか読めない */
const WORK_INTERVAL_MS = 190;

/** 完成してから結果を出すまでの間。すぐ出すと余韻がない */
const FINISH_DELAY_MS = 700;

/** 保存キー。これは今後ずっと変えない（変えると進行が消えたのと同じになる） */
const SAVE_KEY = 'kaihatsu:save';

/** 過去に試した相性の印。ひと目で優劣が分かる記号にする */
const AFFINITY_MARK = { great: '◎', good: '○', normal: '△', bad: '✕' };

const el = {};
for (const id of [
  'hud-date', 'hud-staff', 'hud-funds',
  'setup', 'offers', 'tech-choices', 'staff-choices', 'staff-label',
  'hire-panel', 'hire-label', 'hire-choices', 'start',
  'develop', 'stage', 'progress-bar', 'stats',
  'result', 'result-headline', 'result-sales', 'reviews', 'affinity-hint',
  'settle', 'growth', 'again',
  'yearend', 'yearend-title', 'yearend-headline', 'yearend-rows', 'yearend-grown', 'yearend-next',
  'gameover', 'gameover-detail', 'restart',
]) {
  el[id] = document.getElementById(id);
}

// --- 状態 ---

let company = null;
let picked = { offerId: null, techId: null, staffIds: [] };
let state = null;
let timer = null;
/** 社員IDごとの、画面上の机の位置 */
const deskOf = new Map();

function freshCompany() {
  const seed = (Date.now() % 2147483647) >>> 0;
  return withOffers(createCompany(createStaff, seed));
}

/**
 * 依頼と応募者を並べ直す。会社の状態に持たせるので、リロードしても同じ顔ぶれが出る。
 * 毎回ちがう人が来ることで、採用が「図鑑を埋める作業」ではなく判断になる。
 */
function withOffers(target) {
  const result = generateOffers(target.seed, 3);

  let s = result.seed;
  const applicants = [];
  // 同じ名字が並ぶと紛らわしいので、被ったら引き直す。
  // 何度も引き直して止まらないことがないよう、試行回数で打ち切る
  for (let attempt = 0; attempt < 12 && applicants.length < 2; attempt++) {
    const candidate = generateCandidate(s, attempt);
    s = candidate.seed;
    if (target.staff.some((m) => m.id === candidate.id)) continue;
    if (target.staff.some((m) => m.name === candidate.name)) continue;
    if (applicants.some((a) => a.name === candidate.name)) continue;
    applicants.push(candidate);
  }

  return { ...target, offers: result.offers, applicants, seed: s };
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, serialize(company));
  } catch {
    // 保存できなくても遊びは続けられる。ここで落とさない
  }
}

function load() {
  const fallback = freshCompany();
  try {
    const loaded = deserialize(localStorage.getItem(SAVE_KEY), fallback);
    return loaded.offers?.length ? loaded : withOffers(loaded);
  } catch {
    return fallback;
  }
}

// --- 会社の状況 ---

function renderHud() {
  el['hud-date'].textContent = dateLabel(company);
  el['hud-staff'].textContent = `社員${company.staff.length}人 ・ 月 ${monthlyCost(company)}万`;
  el['hud-funds'].textContent = `${company.funds.toLocaleString()}万円`;
  // 人件費2か月ぶんを切ったら赤にする。じわじわ減っているのに気づかせる
  el['hud-funds'].classList.toggle('danger', company.funds < monthlyCost(company) * 2);
}

// --- 依頼を選ぶ ---

function selectedOffer() {
  return company.offers.find((o) => o.id === picked.offerId) ?? null;
}

function renderSetup() {
  renderHud();

  el.offers.innerHTML = '';
  for (const offer of company.offers) {
    const genre = findGenre(offer.genreId);
    const enough = company.staff.length >= offer.teamSize;
    const cost = offer.teamSize * SALARY_PER_MONTH * offer.months;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'offer';
    button.disabled = !enough;
    button.setAttribute('aria-pressed', String(picked.offerId === offer.id));

    const top = document.createElement('div');
    top.className = 'offer-top';
    top.innerHTML =
      `<span>${genre.emoji}</span>` +
      `<span class="offer-client"></span>` +
      `<span class="offer-reward">${offer.reward.toLocaleString()}万</span>`;
    top.querySelector('.offer-client').textContent = `${offer.client}／${genre.name}`;

    const sub = document.createElement('div');
    sub.className = 'offer-sub';
    // 人件費を並べて出す。報酬だけ見せると、受けるかどうかの判断ができない
    sub.textContent = enough
      ? `${SIZES[offer.size].label} ・ ${offer.months}か月 ・ ${offer.teamSize}人 ・ 人件費 ${cost.toLocaleString()}万`
      : `${SIZES[offer.size].label} ・ ${offer.teamSize}人ひつよう（いまは${company.staff.length}人）`;

    button.append(top, sub);

    // 条件つきの依頼は、何が違うのかをその場に書く。
    // 印だけ出して意味を覚えさせるのは、説明を読ませるのと同じことになる
    const condition = findCondition(offer.condition);
    if (condition) {
      const tag = document.createElement('div');
      tag.className = `offer-tag cond-${condition.key}`;
      tag.textContent = `${condition.emoji} ${condition.label}：${condition.describe}`;
      button.appendChild(tag);
    }
    button.addEventListener('click', () => {
      picked.offerId = offer.id;
      // 必要人数が変わるので、選び直してもらう
      picked.staffIds = [];
      renderSetup();
    });
    el.offers.appendChild(button);
  }

  const offer = selectedOffer();

  el['tech-choices'].innerHTML = '';
  for (const tech of TECHS) {
    const button = choiceButton(tech.emoji, tech.name, '', picked.techId === tech.id, () => {
      picked.techId = tech.id;
      renderSetup();
    });

    // 依頼を選んだあとだけ、そのジャンルで過去に試した結果を思い出す。
    // 試していない組み合わせは伏せたままなので、見つける楽しみは残る
    const known = offer ? recalledAffinity(company, offer.genreId, tech.id) : null;
    const mark = document.createElement('span');
    mark.className = `choice-memo memo-${known ?? 'unknown'}`;
    mark.textContent = known ? AFFINITY_MARK[known] : '？';
    mark.title = known ? affinityHint(known) : 'この組み合わせは まだ ためしていない';
    button.appendChild(mark);

    el['tech-choices'].appendChild(button);
  }

  el['staff-choices'].innerHTML = '';
  for (const staff of company.staff) {
    const on = picked.staffIds.includes(staff.id);
    const button = choiceButton(staff.emoji, staff.name, staff.role, on, () => {
      if (on) picked.staffIds = picked.staffIds.filter((id) => id !== staff.id);
      else if (!offer || picked.staffIds.length < offer.teamSize) picked.staffIds.push(staff.id);
      renderSetup();
    });

    // 育った実感が「選ぶ場所」に出ていないと、育成が起きたことで終わってしまう
    const level = document.createElement('span');
    level.className = 'choice-level';
    level.textContent = `Lv.${staff.level}`;
    button.appendChild(level);

    if (staff.skills.length > 0) {
      const skills = document.createElement('span');
      skills.className = 'choice-skills';
      skills.textContent = staff.skills.map((id) => findSkill(id)?.emoji ?? '').join('');
      skills.title = staff.skills.map((id) => findSkill(id)?.name ?? '').join(' / ');
      button.appendChild(skills);
    }

    el['staff-choices'].appendChild(button);
  }

  el['staff-label'].textContent = offer
    ? `だれにやってもらう？（${picked.staffIds.length} / ${offer.teamSize}人）`
    : 'まず依頼をえらんでください';

  renderHire();

  el.start.disabled = !offer || !picked.techId || picked.staffIds.length !== offer.teamSize;
  el.start.textContent = offer ? `つくりはじめる（${offer.months}か月）` : 'つくりはじめる';
}

function renderHire() {
  const candidates = company.applicants ?? [];
  if (candidates.length === 0) {
    el['hire-panel'].hidden = true;
    return;
  }

  el['hire-panel'].hidden = false;
  el['hire-label'].textContent = `応募が来ています（毎月 ${SALARY_PER_MONTH}万かかります）`;
  el['hire-choices'].innerHTML = '';

  for (const candidate of candidates) {
    const cost = hireCost(candidate);
    const affordable = canHire(company, candidate);

    const button = choiceButton(candidate.emoji, candidate.name, candidate.role, false, () => {
      if (!affordable) return;
      company = hire(company, candidate);
      save();
      renderSetup();
    });
    button.disabled = !affordable;

    // 素質は数値ではなく★で見せる。ひと目で比べられるほうが選びやすい
    const stars = document.createElement('span');
    stars.className = 'choice-level';
    stars.textContent = talentStars(candidate.talent);
    button.appendChild(stars);

    const price = document.createElement('span');
    price.className = 'choice-sub';
    price.textContent = `支度金 ${cost}万`;
    button.appendChild(price);

    el['hire-choices'].appendChild(button);
  }
}

function choiceButton(emoji, name, sub, pressed, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  button.setAttribute('aria-pressed', String(pressed));
  button.innerHTML =
    `<span class="choice-emoji">${emoji}</span>` +
    `<span class="choice-name"></span>` +
    (sub ? `<span class="choice-sub"></span>` : '');
  button.querySelector('.choice-name').textContent = name;
  if (sub) button.querySelector('.choice-sub').textContent = sub;
  button.addEventListener('click', onClick);
  return button;
}

// --- 開発画面 ---

function buildStage() {
  el.stage.innerHTML = '';
  deskOf.clear();

  const count = state.staff.length;
  state.staff.forEach((staff, index) => {
    const desk = document.createElement('div');
    desk.className = 'desk';
    const left = ((index + 0.5) / count) * 100;
    desk.style.left = `${left}%`;
    desk.style.transform = 'translateX(-50%)';

    const emoji = document.createElement('span');
    emoji.className = 'desk-emoji working';
    emoji.textContent = staff.emoji;

    // 机を足元に置く。人が浮いていると「オフィス」に見えない
    const table = document.createElement('span');
    table.className = 'desk-table';

    const name = document.createElement('span');
    name.className = 'desk-name';
    name.textContent = staff.name;

    desk.append(emoji, table, name);
    el.stage.appendChild(desk);
    deskOf.set(staff.id, { left, emoji });
  });
}

function buildStats() {
  el.stats.innerHTML = '';
  for (const stat of STATS) {
    const box = document.createElement('div');
    box.className = 'stat';
    box.innerHTML =
      `<span>${stat.emoji}</span>` +
      `<span class="stat-label"></span>` +
      `<span class="stat-value" id="stat-${stat.key}">0</span>`;
    box.querySelector('.stat-label').textContent = stat.label;
    el.stats.appendChild(box);
  }
}

/** 数字を飛ばす。ここが手触りの本体 */
function popNumber(entry) {
  const desk = deskOf.get(entry.staffId);
  if (!desk) return;
  const stat = STATS.find((s) => s.key === entry.statKey);

  const pop = document.createElement('div');
  pop.className = `pop${entry.critical ? ' crit' : ''}`;
  pop.style.left = `${desk.left}%`;
  // 毎回わずかにずらして、重なっても読めるようにする（見た目だけのゆらぎ）
  pop.style.bottom = `${88 + Math.random() * 18}px`;
  pop.textContent = `+${entry.gain} ${stat.label}`;
  el.stage.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());

  const value = document.getElementById(`stat-${entry.statKey}`);
  if (value) {
    value.textContent = String(state.stats[entry.statKey]);
    value.classList.add('bump');
    setTimeout(() => value.classList.remove('bump'), 130);
  }
}

function startDevelopment() {
  const offer = selectedOffer();
  if (!offer) return;

  const seed = (Date.now() % 2147483647) >>> 0;
  // ID ではなく実体を渡す。育ったレベルとスキルを work() が見るため
  const staff = picked.staffIds.map((id) => company.staff.find((s) => s.id === id));
  state = startProject(
    { genreId: offer.genreId, techId: picked.techId, staff, workCount: offer.workCount, offer },
    seed,
  );

  el.setup.hidden = true;
  el.result.hidden = true;
  el.develop.hidden = false;

  buildStage();
  buildStats();
  el['progress-bar'].style.width = '0%';

  timer = setInterval(() => {
    state = work(state);
    if (state.lastWork) popNumber(state.lastWork);
    el['progress-bar'].style.width = `${progress(state) * 100}%`;

    if (state.done) {
      clearInterval(timer);
      timer = null;
      for (const desk of deskOf.values()) desk.emoji.classList.remove('working');
      setTimeout(showResult, FINISH_DELAY_MS);
    }
  }, WORK_INTERVAL_MS);
}

// --- 結果 ---

function showResult() {
  const result = review(state);
  const offer = state.offer;
  const genre = findGenre(state.genreId);
  const tech = findTech(state.techId);

  el['result-headline'].textContent = result.hit
    ? `ヒット！ ${result.scoreSum} / ${result.maxSum}`
    : `${result.scoreSum} / ${result.maxSum}`;
  el['result-sales'].textContent = `${genre.emoji}${genre.name} × ${tech.emoji}${tech.name}`;

  el.reviews.innerHTML = '';
  for (const r of result.reviews) {
    const row = document.createElement('div');
    row.className = 'review';
    row.innerHTML =
      `<span class="review-score">${r.score}</span>` +
      `<span><span class="review-name"></span><br><span class="review-comment"></span></span>`;
    row.querySelector('.review-name').textContent = r.name;
    row.querySelector('.review-comment').textContent = r.comment;
    el.reviews.appendChild(row);
  }

  // 相性は数値では見せない。次に活きる「気づき」として言葉で返す
  el['affinity-hint'].textContent = affinityHint(result.affinity);

  // 試した組み合わせを控えておく。21通りを記憶に頼らせると発見が苦痛になる
  company = remember(company, state.genreId, state.techId, result.affinity);

  applyGrowth();
  applySettlement(offer, result.payout, result.rejected);

  el.develop.hidden = true;
  el.result.hidden = false;
  save();
}

/**
 * 入金と人件費をまとめて出す。
 * 別々に見せると「儲かったのかどうか」が分からなくなるので、差引まで並べる。
 */
/** 年度をまたいだかどうか。結果画面のあとに決算を出すために覚えておく */
let yearEnded = false;

function applySettlement(offer, payout, rejected = false) {
  const result = settle(company, offer, payout);
  company = result.company;
  yearEnded = result.yearEnded;

  el.settle.innerHTML = '';
  const cond = findCondition(offer.condition);
  const rows = [
    {
      // 減額されたなら、その場で理由まで書く。数字だけ小さいと理不尽に見える
      label: rejected
        ? `入金（${offer.client}）※${cond?.label ?? ''}の基準に届かず減額`
        : `入金（${offer.client}）`,
      value: result.payout,
      sign: 'plus',
    },
    { label: `人件費 ${offer.months}か月ぶん`, value: -result.cost, sign: 'minus' },
    {
      label: '差引',
      value: result.profit,
      sign: result.profit >= 0 ? 'plus' : 'minus',
      total: true,
    },
    { label: '資金', value: company.funds, sign: null, total: true },
  ];

  for (const row of rows) {
    const div = document.createElement('div');
    div.className = `settle-row${row.total ? ' total' : ''}`;
    const label = document.createElement('span');
    label.textContent = row.label;
    const value = document.createElement('span');
    if (row.sign) value.className = row.sign;
    const sign = row.value > 0 && row.sign === 'plus' ? '+' : '';
    value.textContent = `${sign}${row.value.toLocaleString()}万`;
    div.append(label, value);
    el.settle.appendChild(div);
  }

  renderHud();
}

/**
 * 案件の成果を社員に反映して、その様子を出す。
 * 1件ずつ順に浮かび上がらせるのは、まとめて出すと「育った」感じが流れるため。
 */
function applyGrowth() {
  // 育成枠なら経験値が増える。報酬を捨てて人を育てた見返りがここに出る
  const condition = findCondition(state.offer?.condition);
  const result = grow(company.staff, state.contribution, company.seed, condition?.expMul ?? 1);
  company = { ...company, staff: result.staff, seed: result.seed };

  const byStaff = new Map();
  for (const event of result.events) {
    if (!byStaff.has(event.staffId)) byStaff.set(event.staffId, { exp: 0, levels: [], skills: [] });
    const entry = byStaff.get(event.staffId);
    if (event.type === 'exp') entry.exp += event.amount;
    if (event.type === 'levelup') entry.levels.push(event.level);
    if (event.type === 'skill') entry.skills.push(event.skill);
  }

  el.growth.innerHTML = '';
  let index = 0;
  for (const [staffId, entry] of byStaff) {
    const staff = company.staff.find((s) => s.id === staffId);
    const leveledUp = entry.levels.length > 0;

    const row = document.createElement('div');
    row.className = `grow-row${leveledUp ? ' levelup' : ''}`;
    row.style.animationDelay = `${index * 0.12}s`;

    const emoji = document.createElement('span');
    emoji.className = 'grow-emoji';
    emoji.textContent = staff.emoji;

    const body = document.createElement('div');
    body.className = 'grow-body';

    const name = document.createElement('span');
    name.className = 'grow-name';
    name.textContent = staff.name;

    const exp = document.createElement('span');
    exp.className = 'grow-exp';
    const need = expToNext(staff.level);
    exp.textContent =
      staff.level >= MAX_LEVEL
        ? `+${entry.exp} 経験値 ・ これ以上は育たない`
        : `+${entry.exp} 経験値 ・ つぎまで ${Math.max(0, need - staff.exp)}`;

    const track = document.createElement('div');
    track.className = 'grow-track';
    const fill = document.createElement('div');
    fill.className = 'grow-fill';
    fill.style.width = `${staff.level >= MAX_LEVEL ? 100 : Math.min(100, (staff.exp / need) * 100)}%`;
    track.appendChild(fill);

    body.append(name, exp, track);

    for (const skill of entry.skills) {
      const learned = document.createElement('span');
      learned.className = 'grow-skill';
      learned.textContent = `${skill.emoji} ${skill.name} をおぼえた！ ${skill.describe}`;
      body.appendChild(learned);
    }

    const level = document.createElement('span');
    level.className = 'grow-level';
    level.textContent = leveledUp ? `Lv.${staff.level} ↑` : `Lv.${staff.level}`;

    row.append(emoji, body, level);
    el.growth.appendChild(row);
    index++;
  }
}

// --- 次へ・倒産 ---

/**
 * 年度末の決算を出す。
 * 月は進んでいるのに節目が何も無いと、長く遊ぶほど平板になる。
 */
function showYearEnd() {
  const summary = yearSummary(company);
  company = closeYear(company);
  save();

  el['yearend-title'].textContent = `${summary.year}年目 決算`;
  el['yearend-headline'].textContent = summary.title;

  el['yearend-rows'].innerHTML = '';
  const rows = [
    { label: '受けた案件', value: `${summary.count}件` },
    { label: '売上', value: `${summary.payout.toLocaleString()}万` },
    { label: '人件費', value: `−${summary.cost.toLocaleString()}万` },
    {
      label: '差引',
      value: `${summary.profit >= 0 ? '+' : ''}${summary.profit.toLocaleString()}万`,
      total: true,
    },
    { label: '資金', value: `${summary.fundsAfter.toLocaleString()}万`, total: true },
  ];
  if (summary.hired > 0) rows.push({ label: '入社', value: `${summary.hired}人` });
  if (summary.discovered > 0) {
    rows.push({ label: '見つけた組み合わせ', value: `${summary.discovered}通り` });
  }

  for (const row of rows) {
    const div = document.createElement('div');
    div.className = `settle-row${row.total ? ' total' : ''}`;
    const label = document.createElement('span');
    label.textContent = row.label;
    const value = document.createElement('span');
    value.textContent = row.value;
    div.append(label, value);
    el['yearend-rows'].appendChild(div);
  }

  // 稼ぎより、人が変わったことのほうが「続けている実感」になる
  el['yearend-grown'].innerHTML = '';
  if (summary.grown.length === 0) {
    const none = document.createElement('div');
    none.className = 'yearend-grown-row';
    none.textContent = 'ことしは 誰も レベルが上がらなかった';
    el['yearend-grown'].appendChild(none);
  } else {
    for (const person of summary.grown) {
      const row = document.createElement('div');
      row.className = 'yearend-grown-row';
      row.innerHTML = `<span>${person.emoji}</span><span class="grow-name"></span><b>Lv.${person.from} → ${person.to}</b>`;
      row.querySelector('.grow-name').textContent = person.name;
      el['yearend-grown'].appendChild(row);
    }
  }

  el.result.hidden = true;
  el.yearend.hidden = false;
}

function nextProject() {
  if (company.bankrupt) {
    el.result.hidden = true;
    el['gameover-detail'].textContent =
      `${dateLabel(company)}・${company.projects}件で力尽きました。` +
      `社員は${company.staff.length}人いました。`;
    el.gameover.hidden = false;
    return;
  }

  // 年度をまたいでいたら、先に決算を見せる
  if (yearEnded) {
    yearEnded = false;
    showYearEnd();
    return;
  }

  company = withOffers(company);
  picked = { offerId: null, techId: null, staffIds: [] };
  save();

  el.result.hidden = true;
  el.develop.hidden = true;
  el.setup.hidden = false;
  renderSetup();
}

el['yearend-next'].addEventListener('click', () => {
  company = withOffers(company);
  picked = { offerId: null, techId: null, staffIds: [] };
  save();
  el.yearend.hidden = true;
  el.setup.hidden = false;
  renderSetup();
});

el.start.addEventListener('click', startDevelopment);
el.again.addEventListener('click', nextProject);
el.restart.addEventListener('click', () => {
  if (timer) clearInterval(timer);
  timer = null;
  company = freshCompany();
  picked = { offerId: null, techId: null, staffIds: [] };
  save();
  el.gameover.hidden = true;
  el.yearend.hidden = true;
  el.result.hidden = true;
  el.develop.hidden = true;
  el.setup.hidden = false;
  renderSetup();
});

// --- 起動 ---

company = load();
renderSetup();
