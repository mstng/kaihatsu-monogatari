// このファイルが何をするか:
// 画面の描画と演出。ゲームのルールは一切書かない（全部 src/dev.js にある）。
//
// ■ 段階1でいちばん力を入れているところ
//   work() が返す「1回ぶんの作業」を受け取って、数字をポンと飛ばす。
//   カイロソフト系の気持ちよさはここにしかないので、
//   間隔・跳ね方・色をいじりやすい形にしてある。

import {
  STATS,
  GENRES,
  TECHS,
  STAFF_POOL,
  WORK_COUNT,
  startProject,
  work,
  progress,
  review,
  affinityHint,
  findStaff,
  findGenre,
  findTech,
} from './dev.js';

// --- 演出のつまみ（手触りはここで変わる） ---

/** 1回の作業の間隔(ms)。短いほど気持ちいいが、速すぎると何が起きたか読めない */
const WORK_INTERVAL_MS = 190;

/** 完成してから結果を出すまでの間。すぐ出すと余韻がない */
const FINISH_DELAY_MS = 700;

const el = {
  setup: document.getElementById('setup'),
  genreChoices: document.getElementById('genre-choices'),
  techChoices: document.getElementById('tech-choices'),
  staffChoices: document.getElementById('staff-choices'),
  staffLabel: document.getElementById('staff-label'),
  start: document.getElementById('start'),
  develop: document.getElementById('develop'),
  stage: document.getElementById('stage'),
  progressBar: document.getElementById('progress-bar'),
  stats: document.getElementById('stats'),
  result: document.getElementById('result'),
  resultHeadline: document.getElementById('result-headline'),
  resultSales: document.getElementById('result-sales'),
  reviews: document.getElementById('reviews'),
  affinityHint: document.getElementById('affinity-hint'),
  again: document.getElementById('again'),
};

const MAX_STAFF = 3;

let picked = { genreId: null, techId: null, staffIds: [] };
let state = null;
let timer = null;
/** 社員IDごとの、画面上の机の位置 */
const deskOf = new Map();

// --- 選択画面 ---

function renderChoices() {
  el.genreChoices.innerHTML = '';
  for (const genre of GENRES) {
    el.genreChoices.appendChild(
      choiceButton(genre.emoji, genre.name, '', picked.genreId === genre.id, () => {
        picked.genreId = genre.id;
        renderChoices();
      }),
    );
  }

  el.techChoices.innerHTML = '';
  for (const tech of TECHS) {
    el.techChoices.appendChild(
      choiceButton(tech.emoji, tech.name, '', picked.techId === tech.id, () => {
        picked.techId = tech.id;
        renderChoices();
      }),
    );
  }

  el.staffChoices.innerHTML = '';
  for (const staff of STAFF_POOL) {
    const on = picked.staffIds.includes(staff.id);
    el.staffChoices.appendChild(
      choiceButton(staff.emoji, staff.name, staff.role, on, () => {
        if (on) picked.staffIds = picked.staffIds.filter((id) => id !== staff.id);
        else if (picked.staffIds.length < MAX_STAFF) picked.staffIds.push(staff.id);
        renderChoices();
      }),
    );
  }

  el.staffLabel.textContent = `だれにやってもらう？（${picked.staffIds.length} / ${MAX_STAFF}人）`;
  el.start.disabled = !picked.genreId || !picked.techId || picked.staffIds.length === 0;
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

  const count = state.staffIds.length;
  state.staffIds.forEach((staffId, index) => {
    const staff = findStaff(staffId);
    const desk = document.createElement('div');
    desk.className = 'desk';
    // 人数に応じて均等に並べる
    const left = ((index + 0.5) / count) * 100;
    desk.style.left = `${left}%`;
    desk.style.transform = 'translateX(-50%)';

    const emoji = document.createElement('span');
    emoji.className = 'desk-emoji working';
    emoji.textContent = staff.emoji;

    const name = document.createElement('span');
    name.className = 'desk-name';
    name.textContent = staff.name;

    desk.append(emoji, name);
    el.stage.appendChild(desk);
    deskOf.set(staffId, { left, emoji });
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

/** 数字を飛ばす。ここが段階1の本体 */
function popNumber(entry) {
  const desk = deskOf.get(entry.staffId);
  if (!desk) return;
  const stat = STATS.find((s) => s.key === entry.statKey);

  const pop = document.createElement('div');
  pop.className = `pop${entry.critical ? ' crit' : ''}`;
  pop.style.left = `${desk.left}%`;
  // 机の高さから少し上に出す。毎回わずかにずらして、重なっても読めるようにする
  pop.style.bottom = `${88 + Math.random() * 18}px`;
  pop.textContent = `+${entry.gain} ${stat.label}`;
  el.stage.appendChild(pop);
  // アニメーションが終わったら捨てる。放置するとDOMが増え続ける
  pop.addEventListener('animationend', () => pop.remove());

  const value = document.getElementById(`stat-${entry.statKey}`);
  if (value) {
    value.textContent = String(state.stats[entry.statKey]);
    value.classList.add('bump');
    setTimeout(() => value.classList.remove('bump'), 130);
  }
}

function startDevelopment() {
  const seed = (Date.now() % 2147483647) >>> 0;
  state = startProject(picked, seed);

  el.setup.hidden = true;
  el.result.hidden = true;
  el.develop.hidden = false;

  buildStage();
  buildStats();
  el.progressBar.style.width = '0%';

  timer = setInterval(() => {
    state = work(state);
    if (state.lastWork) popNumber(state.lastWork);
    el.progressBar.style.width = `${progress(state) * 100}%`;

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
  const genre = findGenre(state.genreId);
  const tech = findTech(state.techId);

  el.resultHeadline.textContent = result.hit
    ? `ヒット！ ${result.scoreSum} / ${result.maxSum}`
    : `${result.scoreSum} / ${result.maxSum}`;
  el.resultSales.textContent = `${genre.emoji}${genre.name} × ${tech.emoji}${tech.name}　売上 ${result.sales.toLocaleString()}万円`;

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
  el.affinityHint.textContent = affinityHint(result.affinity);

  el.develop.hidden = true;
  el.result.hidden = false;
}

// --- 操作 ---

el.start.addEventListener('click', startDevelopment);
el.again.addEventListener('click', () => {
  if (timer) clearInterval(timer);
  timer = null;
  el.result.hidden = true;
  el.develop.hidden = true;
  el.setup.hidden = false;
  renderChoices();
});

renderChoices();
