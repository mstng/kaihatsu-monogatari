// このテストが何を守るか:
// 「画面が起動して、最初の選択肢が並ぶ」こと。
//
// なぜ要るか:
//   段階3で CLIENTS（依頼元の名前）が未定義のまま参照されていて、
//   起動直後に例外で止まり、画面が真っ白になった。
//   それでも他のテストは全部通っていた。ルールの関数だけを呼んでいて、
//   ui.js を一度も読み込んでいなかったため。
//
//   ここでは最小の DOM を用意して ui.js を実際に読み込む。
//   描画の見た目までは見ないが、「起動して落ちない」「依頼が並ぶ」までは押さえる。

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 記録つきの最小要素。子が足されたかを数えられるようにしておく */
function makeElement(id) {
  const element = {
    id,
    textContent: '',
    innerHTML: '',
    title: '',
    style: {},
    hidden: false,
    disabled: false,
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    append(...nodes) {
      element.children.push(...nodes);
    },
    addEventListener() {},
    setAttribute() {},
    querySelector() {
      return makeElement('query');
    },
  };
  return element;
}

/** id ごとに同じ要素を返す（ui.js は起動時に getElementById で集める） */
function installDom() {
  const registry = new Map();
  const byId = (id) => {
    if (!registry.has(id)) registry.set(id, makeElement(id));
    return registry.get(id);
  };

  globalThis.document = { getElementById: byId, createElement: (tag) => makeElement(tag) };
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.get(key) ?? null;
    },
    setItem(key, value) {
      this.store.set(key, value);
    },
  };
  // 開発ループは動かさない。ここで見たいのは起動だけ
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  globalThis.setTimeout = () => 0;

  return registry;
}

test('画面が起動して例外を投げない', async () => {
  const registry = installDom();
  await assert.doesNotReject(() => import('../src/ui.js'));

  // 起動しただけで何も並ばないなら、実質壊れているのと同じ
  assert.ok(registry.get('offers').children.length > 0, '依頼が1件も並んでいない');
  assert.ok(registry.get('tech-choices').children.length > 0, '技術の選択肢が並んでいない');
  assert.ok(registry.get('staff-choices').children.length > 0, '社員が1人も並んでいない');
});

test('会社の状況が表示されている', async () => {
  // 同じプロセス内では ui.js は一度しか評価されないので、上のテストの結果を見る
  const element = globalThis.document.getElementById('hud-funds');
  assert.match(element.textContent, /万円/, '資金が出ていない');
  assert.match(globalThis.document.getElementById('hud-date').textContent, /年目/, '日付が出ていない');
});
