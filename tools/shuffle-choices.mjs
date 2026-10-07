#!/usr/bin/env node
/* 선지 순서 재배열: node tools/shuffle-choices.mjs [--dry]
 *
 * 작성 단계에서 회차마다 정답 번호 순서가 비슷하게 나와(예: 1~5번이 모두 ③⑤②④①) 회차를 이어 풀면
 * 패턴이 보이는 문제가 있었다. 언어이해·논리판단·정보추론 문항의 선지를 시드 고정으로 재배열해
 * 회차·영역마다 다른 정답 순서를 만든다.
 * - 숫자 오름차순 선지와 'ㄱ, ㄴ' 보기 조합형 선지는 관례대로 순서를 유지한다.
 * - 해설의 ①~⑤ 표기를 새 번호로 바꾸고, 뒤따르는 조사(은/는, 이/가, 을/를, 과/와, 으로/로)를 받침에 맞게 고친다.
 * - 영역 안 정답 분포는 ①~⑤ 균등(차이 1 이내), 같은 번호 3연속 금지, 다른 회차의 같은 영역과 겹치는 위치 최소화.
 * 이미 재배열한 데이터에 다시 실행해도 같은 결과가 되도록, 원래 순서는 data/*.js의 현재 상태를 기준으로 한다(한 번만 실행). */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const CIRC = ['①', '②', '③', '④', '⑤'];
const BATCHIM = [true, false, true, false, false]; // 일, 이, 삼, 사, 오
const HEADER = '/* 자동 생성 파일: tools/build-data.py. 형식은 docs/SCHEMA.md 참고. */\n';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rnd) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

function load(file) {
  const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/registry.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx);
  const set = Object.values(ctx.HMAT.sets)[0];
  return JSON.parse(JSON.stringify(Object.values(set.sections)[0]));
}

// 관례상 순서가 정해진 선지는 섞지 않는다: 오름·내림차순 숫자(단위 공통), 'ㄱ, ㄴ' 보기 조합,
// 'A부스~E부스'·'갑~무'처럼 짧은 이름표가 정렬된 경우.
const COMBO_RE = /^[ㄱ-ㅎ](,\s*[ㄱ-ㅎ])*$/;
const NUM_RE = /^(약\s*)?(-?[\d,]*\.?\d+)\s*([^\d\s][^\d]{0,7})?$/;
const GAP = '갑을병정무기경신임계';
function sortedBy(keys, cmp) {
  const asc = keys.every((k, i) => i === 0 || cmp(keys[i - 1], k) <= 0);
  const desc = keys.every((k, i) => i === 0 || cmp(keys[i - 1], k) >= 0);
  return asc || desc;
}
function fixedOrder(it) {
  const ch = (it.choices || []).map((x) => String(x).trim());
  if (!ch.length) return false;
  if (ch.every((x) => COMBO_RE.test(x))) return true;
  const nums = ch.map((x) => x.match(NUM_RE));
  if (nums.every(Boolean) && new Set(nums.map((m) => (m[3] || '').trim())).size === 1) {
    return sortedBy(nums.map((m) => parseFloat(m[2].replace(/,/g, ''))), (a, b) => a - b);
  }
  if (ch.every((x) => x.length <= 8)) {
    if (ch.every((x) => GAP.includes(x[0])) && sortedBy(ch.map((x) => GAP.indexOf(x[0])), (a, b) => a - b)) return true;
    if (sortedBy(ch, (a, b) => a.localeCompare(b, 'ko'))) return true;
  }
  return false;
}

/* 해설의 원문자 번호를 새 번호로 바꾸고 조사를 맞춘다. map[oldIdx] = newIdx (0 기반) */
function remapText(text, map) {
  // 범위 표기(①~③)는 재배열 후 의미가 깨지므로 개별 나열로 풀어 쓴다.
  let s = text.replace(/([①-⑤])\s*[~∼]\s*([①-⑤])/g, (_, a, b) => {
    const i = CIRC.indexOf(a), j = CIRC.indexOf(b);
    const list = []; for (let k = i; k <= j; k++) list.push(k);
    return list.map((k) => '\u0000' + k).join(', ');
  });
  s = s.replace(/[①-⑤]/g, (c) => '\u0000' + CIRC.indexOf(c));
  // 자리표시자 → 새 번호 + 조사 보정
  // 번호와 조사 사이에 괄호 설명이 끼는 경우('①(제동→조향)과')도 조사를 맞춘다.
  return s.replace(/\u0000(\d)(\([^()\u0000]*\))?(으로|로|은|는|을|를|과|와|이|가)?/g, (m, d, paren, josa, off, whole) => {
    const ni = map[+d];
    const out = CIRC[ni] + (paren || '');
    if (!josa) return out;
    const b = BATCHIM[ni];
    const rest = whole.slice(off + m.length, off + m.length + 2);
    switch (josa) {
      case '은': case '는': return out + (b ? '은' : '는');
      case '을': case '를': return out + (b ? '을' : '를');
      case '과': case '와': return out + (b ? '과' : '와');
      case '으로': case '로': return out + (ni === 0 ? '로' : b ? '으로' : '로'); // ① 일 → '일로'
      case '이': case '가': {
        // '이다/이며/이고/이므로/이나/이지만/이어서/이라'는 서술격 조사이므로 그대로 둔다.
        if (josa === '이' && /^(다|며|고|므|나|지|어|라|었|면|자)/.test(rest)) return out + '이';
        return out + (b ? '이' : '가');
      }
    }
    return out + josa;
  });
}

function planSequence(items, rnd, others) {
  const n = items.length;
  const fixed = items.map((it) => (fixedOrder(it) ? it.answer : 0));
  const base = Math.floor(n / 5), extra = n % 5;
  for (let attempt = 0; attempt < 20000; attempt++) {
    // 번호별 목표 개수: base개씩, 나머지는 무작위 번호에 1개씩
    const target = [base, base, base, base, base];
    shuffle([0, 1, 2, 3, 4], rnd).slice(0, extra).forEach((k) => target[k]++);
    fixed.forEach((a) => { if (a) target[a - 1]--; });
    if (target.some((c) => c < 0)) continue;
    const pool = [];
    target.forEach((c, k) => { for (let i = 0; i < c; i++) pool.push(k + 1); });
    shuffle(pool, rnd);
    const seq = fixed.map((a) => a || pool.pop());
    let ok = true;
    for (let i = 2; i < n && ok; i++) if (seq[i] === seq[i - 1] && seq[i] === seq[i - 2]) ok = false;
    if (!ok) continue;
    // 순서를 고정한 문항은 원래 정답 그대로이므로, 겹침은 움직일 수 있는 자리끼리만 센다.
    const free = fixed.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
    const same = (a, b) => free.filter((i) => a[i] === b[i]).length;
    if (same(seq, items.map((it) => it.answer)) > Math.ceil(free.length * 0.35)) continue;
    if (others.some((o) => same(seq, o) > Math.ceil(free.length * 0.35))) continue;
    return seq;
  }
  throw new Error('정답 순서를 만들지 못함');
}

function permuteItem(it, newAns, rnd) {
  // order[newIdx] = oldIdx, 정답이 newAns-1 자리로 가게 한다.
  const rest = shuffle([0, 1, 2, 3, 4].filter((k) => k !== it.answer - 1), rnd);
  const order = [];
  for (let k = 0; k < 5; k++) order.push(k === newAns - 1 ? it.answer - 1 : rest.pop());
  const map = []; order.forEach((oldIdx, newIdx) => { map[oldIdx] = newIdx; });
  if (it.choices) it.choices = order.map((o) => it.choices[o]);
  if (it.choiceCharts) it.choiceCharts = order.map((o) => it.choiceCharts[o]);
  it.answer = newAns;
  it.explanation = remapText(it.explanation, map);
  return map;
}

const report = [];
const plans = {};
for (const sec of ['verbal', 'logic', 'data']) {
  const done = [];
  for (const n of [1, 2, 3]) {
    const file = `data/set${n}-${sec}.js`;
    const items = load(file);
    const rnd = mulberry32(0x5eed0000 + n * 97 + sec.length * 7919);
    const seq = planSequence(items, rnd, done);
    done.push(seq);
    let moved = 0;
    items.forEach((it, i) => {
      if (fixedOrder(it)) return;
      permuteItem(it, seq[i], rnd);
      moved++;
    });
    plans[file] = seq;
    report.push(`${file}: 재배열 ${moved}/${items.length}, 정답 ${seq.map((a) => CIRC[a - 1]).join('')}`);
    if (!DRY) fs.writeFileSync(path.join(ROOT, file), HEADER + `HMAT.add(${n}, '${sec}', ${JSON.stringify(items, null, 1)});\n`);
  }
}
console.log(report.join('\n'));
if (DRY) console.log('(dry run: 파일을 쓰지 않음)');
