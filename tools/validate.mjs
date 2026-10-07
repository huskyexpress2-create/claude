#!/usr/bin/env node
/* 문항 데이터 검증: node tools/validate.mjs
 * 스키마, 문항 수, 정답 번호 분포, group 일관성, 자료 형식, 인성 은행 구성을 점검한다.
 * 오류가 있으면 종료 코드 1. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
const load = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return false;
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: rel });
  return true;
};

load('data/registry.js');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dataFiles = [...html.matchAll(/<script src="(data\/[^"]+)"/g)].map((m) => m[1]).filter((f) => f !== 'data/registry.js');
const missing = dataFiles.filter((f) => !load(f));
load('assets/js/personality.js');

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
if (missing.length) err(`index.html이 참조하는 데이터 파일 없음: ${missing.join(', ')}`);

const EXPECT = { verbal: [15, 'VE'], logic: [10, 'LO'], data: [15, 'DA'], diagram: [8, 'DI'], spatial: [10, 'SP'] };
const TAG_OK = /^<\/?(b|u|br|sup|sub|i|em|strong)\s*\/?>$/;

function checkRich(where, s) {
  if (typeof s !== 'string') return;
  for (const m of s.matchAll(/<[^>]*>/g)) if (!TAG_OK.test(m[0])) err(`${where}: 허용되지 않은 태그 ${m[0]}`);
}

function checkChart(where, c) {
  if (!c || c.kind !== 'chart') return err(`${where}: chart가 아님`);
  const types = ['bar', 'line', 'hbar', 'pie', 'stacked'];
  if (!types.includes(c.type)) err(`${where}: 알 수 없는 차트 type ${c.type}`);
  const n = (c.categories || []).length;
  if (!n) err(`${where}: categories 없음`);
  if (!c.series || !c.series.length) err(`${where}: series 없음`);
  (c.series || []).forEach((s, i) => {
    if (!Array.isArray(s.values) || s.values.length !== n) err(`${where}: series[${i}] 값 개수 ${s.values && s.values.length} ≠ 범주 ${n}`);
    if ((s.values || []).some((v) => typeof v !== 'number' || !isFinite(v))) err(`${where}: series[${i}]에 숫자가 아닌 값`);
  });
  if (c.type === 'pie' && c.series && c.series.length !== 1) err(`${where}: pie는 series 1개`);
}

function checkMaterial(where, m) {
  if (m.kind === 'table') {
    const w = (m.columns || []).length;
    if (!w) err(`${where}: 표 columns 없음`);
    (m.rows || []).forEach((r, i) => { if (!Array.isArray(r) || r.length !== w) err(`${where}: 표 ${i + 1}행 칸 수 ${r && r.length} ≠ ${w}`); });
  } else if (m.kind === 'chart') checkChart(where, m);
  else if (m.kind === 'text') { if (!m.body) err(`${where}: text 자료 body 없음`); checkRich(where, m.body); }
  else err(`${where}: 알 수 없는 자료 kind ${m.kind}`);
}

function checkItem(setNo, key, it, idx) {
  const where = `${setNo}회 ${key} ${it.id || '#' + (idx + 1)}`;
  const [, abbr] = EXPECT[key];
  const wantId = `S${setNo}-${abbr}-${String(idx + 1).padStart(2, '0')}`;
  if (it.id !== wantId) err(`${where}: id가 ${wantId}이어야 함`);
  if (!it.stem) err(`${where}: 발문 없음`);
  if (!it.subtype) err(`${where}: subtype 없음`);
  if (!Number.isInteger(it.answer) || it.answer < 1 || it.answer > 5) err(`${where}: answer ${it.answer}`);
  if (!it.explanation || it.explanation.length < 15) err(`${where}: 해설이 없거나 너무 짧음`);
  const kinds = ['choices', 'choiceCharts', 'choiceSvgs'].filter((k) => it[k]);
  if (kinds.length !== 1) err(`${where}: 선지 필드가 정확히 하나여야 함 (${kinds.join(',') || '없음'})`);
  const ch = it[kinds[0]] || [];
  if (ch.length !== 5) err(`${where}: 선지 ${ch.length}개`);
  if (it.choices) {
    if (new Set(it.choices.map((c) => String(c).trim())).size !== it.choices.length) err(`${where}: 중복 선지`);
    it.choices.forEach((c, i) => { if (/^\s*[①-⑤]/.test(c)) warn(`${where}: 선지 ${i + 1}에 번호 기호 포함`); checkRich(where, c); });
  }
  if (it.choiceCharts) it.choiceCharts.forEach((c, i) => checkChart(`${where} 선지${i + 1}`, c));
  if (it.choiceSvgs) {
    it.choiceSvgs.forEach((s, i) => { if (!/^<svg[\s\S]*<\/svg>\s*$/.test(s)) err(`${where}: 선지${i + 1} SVG 형식`); });
    if (new Set(it.choiceSvgs).size !== 5) err(`${where}: 동일한 SVG 선지가 있음`);
  }
  if (it.figure && !/^<svg[\s\S]*<\/svg>\s*$/.test(it.figure.svg || '')) err(`${where}: figure SVG 형식`);
  [it.passage, it.stem, it.explanation, it.passageTitle].forEach((s) => checkRich(where, s));
  if (it.box) { if (!it.box.title || !Array.isArray(it.box.items) || !it.box.items.length) err(`${where}: box 형식`); (it.box.items || []).forEach((s) => checkRich(where, s)); }
  (it.materials || []).forEach((m, i) => checkMaterial(`${where} 자료${i + 1}`, m));
  if ((key === 'verbal') && !it.passage) err(`${where}: 언어이해 지문 없음`);
  if (key === 'data' && !(it.materials && it.materials.length)) err(`${where}: 자료해석 자료 없음`);
}

function checkDistribution(where, answers) {
  const cnt = [0, 0, 0, 0, 0];
  answers.forEach((a) => cnt[a - 1]++);
  if (Math.max(...cnt) - Math.min(...cnt) > 1) err(`${where}: 정답 분포 치우침 ${cnt.join('/')}`);
  for (let i = 2; i < answers.length; i++) if (answers[i] === answers[i - 1] && answers[i] === answers[i - 2]) warn(`${where}: 같은 정답 번호 3연속 (${i - 1}~${i + 1}번)`);
  return cnt;
}

const summary = [];
for (const setNo of [1, 2, 3]) {
  const set = ctx.HMAT.sets[setNo];
  if (!set) { err(`${setNo}회 데이터 없음`); continue; }
  for (const [key, [count]] of Object.entries(EXPECT)) {
    const payload = set.sections[key];
    if (!payload) { err(`${setNo}회 ${key} 없음`); continue; }
    const items = Array.isArray(payload) ? payload : payload.items;
    if (key === 'diagram') {
      const r = payload.rules;
      if (!r || !Array.isArray(r.symbols) || r.symbols.length < 3) err(`${setNo}회 도식 규칙표 형식`);
      else r.symbols.forEach((s, i) => { if (!s.svg || !s.desc) err(`${setNo}회 도식 규칙 ${i + 1}: svg/desc 없음`); });
    }
    if (!Array.isArray(items)) { err(`${setNo}회 ${key}: 문항 배열 없음`); continue; }
    if (items.length !== count) err(`${setNo}회 ${key}: 문항 ${items.length}개 (기대 ${count})`);
    items.forEach((it, i) => checkItem(setNo, key, it, i));
    // group 일관성
    const groups = {};
    items.forEach((it, i) => { if (it.group) (groups[it.group.id] = groups[it.group.id] || []).push([i, it]); });
    Object.entries(groups).forEach(([gid, list]) => {
      if (list.length < 2) warn(`${setNo}회 ${key} group ${gid}: 문항 1개뿐`);
      const ref = JSON.stringify([list[0][1].passage || '', list[0][1].materials || [], list[0][1].group.label]);
      list.forEach(([i, it], k) => {
        if (JSON.stringify([it.passage || '', it.materials || [], it.group.label]) !== ref) err(`${setNo}회 ${key} group ${gid}: ${it.id}의 지문/자료/라벨이 다름`);
        if (i !== list[0][0] + k) err(`${setNo}회 ${key} group ${gid}: 문항이 연속 배치되지 않음`);
      });
    });
    const cnt = checkDistribution(`${setNo}회 ${key}`, items.map((it) => it.answer));
    summary.push(`${setNo}회 ${key.padEnd(7)} ${String(items.length).padStart(2)}문항 정답분포 ${cnt.join('/')}`);
  }
}

// 인성 은행
const bank = ctx.HMAT.personalityBank || [];
const ids = new Set(), texts = new Map(), pairs = {};
const dimCount = {};
bank.forEach((s) => {
  if (ids.has(s.id)) err(`인성 ${s.id}: id 중복`);
  ids.add(s.id);
  const t = String(s.text || '').replace(/\s+/g, ' ').trim();
  if (!t) err(`인성 ${s.id}: 문장 없음`);
  if (texts.has(t)) err(`인성 ${s.id}: ${texts.get(t)}와 문장 중복`);
  texts.set(t, s.id);
  if (!['C', 'E', 'N', 'O', 'A', 'I', 'L'].includes(s.dim)) err(`인성 ${s.id}: dim ${s.dim}`);
  if (s.key !== 1 && s.key !== -1) err(`인성 ${s.id}: key ${s.key}`);
  if (s.lie !== (s.dim === 'L')) err(`인성 ${s.id}: lie 플래그와 dim 불일치`);
  dimCount[s.dim] = (dimCount[s.dim] || 0) + 1;
  if (s.pair) (pairs[s.pair] = pairs[s.pair] || []).push(s);
});
Object.entries(pairs).forEach(([p, list]) => {
  if (list.length !== 2) err(`인성 pair ${p}: 구성원 ${list.length}개`);
  else if (list[0].dim !== list[1].dim) err(`인성 pair ${p}: 차원이 다름`);
});
if (bank.length < 500) err(`인성 은행 ${bank.length}문장 (500 이상 필요)`);
if (ctx.HMATPersonality && bank.length) {
  for (const setNo of [1, 2, 3]) {
    const b = ctx.HMATPersonality.build(setNo);
    if (b.blocks.length !== 52) err(`인성 ${setNo}회: Ⅰ부 묶음 ${b.blocks.length}개`);
    if (b.items.length !== 300) err(`인성 ${setNo}회: Ⅱ부 ${b.items.length}문항`);
    const all = b.blocks.flat().concat(b.items);
    if (new Set(all).size !== all.length) err(`인성 ${setNo}회: 같은 진술이 두 번 출제됨`);
    const byId = Object.fromEntries(bank.map((s) => [s.id, s]));
    b.blocks.forEach((bl, i) => { if (new Set(bl.map((id) => byId[id].dim)).size !== 3) err(`인성 ${setNo}회 묶음 ${i + 1}: 차원 중복`); });
    summary.push(`인성 ${setNo}회 Ⅰ부 ${b.blocks.length}묶음 · Ⅱ부 ${b.items.length}문항`);
  }
}
summary.push(`인성 은행 ${bank.length}문장 ${JSON.stringify(dimCount)} · 일관성 쌍 ${Object.keys(pairs).length}`);

console.log(summary.join('\n'));
if (warns.length) console.log('\n경고 ' + warns.length + '건\n- ' + warns.join('\n- '));
if (errors.length) { console.log('\n오류 ' + errors.length + '건\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\n검증 통과');
