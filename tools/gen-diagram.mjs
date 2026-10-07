#!/usr/bin/env node
/**
 * tools/gen-diagram.mjs — HMAT 대비 '비공식' 모의고사 · 도식이해(diagram) 3회분 생성기
 *
 *   실행: node tools/gen-diagram.mjs
 *   출력: data/set1-diagram.js, data/set2-diagram.js, data/set3-diagram.js
 *
 * - 외부 의존성 없음(Node.js 22 ESM). 시드 고정 PRNG(mulberry32)라서 다시 실행해도 결과가 같다.
 * - 형식은 docs/SCHEMA.md의 '도식이해 Rules'와 Item을 따른다.
 * - 1회: 4자리 문자열 변환(기호 5개)
 *   2회: 3×3 격자 변환(기호 5개, 그림 선지)
 *   3회: 4자리 문자열 + 조건 분기 마름모(변환 기호 4개 + 조건 기호 2개)
 * - 문항마다 정답이 하나뿐인지 코드로 검사한다(assert). 조건을 만족하는 문항을 찾을 때까지
 *   같은 PRNG에서 다시 뽑고, 회차 단위 검사(기호 사용 분포 등)에 실패하면 시드를 바꿔 회차를 다시 만든다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SEED = { 1: 20261001, 2: 20261002, 3: 20261003 };
const MAX_ITEM_ATTEMPTS = 20000;
const MAX_SET_RETRIES = 40;

/* ------------------------------------------------------------------ */
/* PRNG                                                                */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rng {
  constructor(seed) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  int(n) { return Math.floor(this.r() * n); }
  pick(a) { return a[this.int(a.length)]; }
  shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = this.int(i + 1); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }
  weighted(items, wfn) {
    const ws = items.map(wfn); const tot = ws.reduce((s, w) => s + w, 0);
    let x = this.r() * tot;
    for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x < 0) return items[i]; }
    return items[items.length - 1];
  }
}

/* ------------------------------------------------------------------ */
/* 한국어 조사 · 번호                                                   */
/* ------------------------------------------------------------------ */
const CIRC = ['①', '②', '③', '④', '⑤'];
const CIRC_EUN = ['①은', '②는', '③은', '④는', '⑤는'];
// 마지막 글자의 받침 번호(0: 없음, 8: ㄹ). 알파벳·숫자는 읽는 소리로 판단한다.
function jong(word) {
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
  if ('LR178'.includes(ch)) return 8; // 엘, 알, 일, 칠, 팔
  if ('MN0369'.includes(ch)) return ch === '9' ? 0 : 21; // 엠, 엔, 영, 삼, 육 (9=구: 받침 없음)
  return 0;
}
const J = {
  eul: (w) => w + (jong(w) ? '을' : '를'),
  eun: (w) => w + (jong(w) ? '은' : '는'),
  ga: (w) => w + (jong(w) ? '이' : '가'),
  wa: (w) => w + (jong(w) ? '과' : '와'),
  ro: (w) => { const j = jong(w); return w + (j && j !== 8 ? '으로' : '로'); },
};

/* ------------------------------------------------------------------ */
/* SVG 기본 요소                                                        */
/* ------------------------------------------------------------------ */
const FONT = "Pretendard, 'Noto Sans KR', sans-serif";
const INK = '#222';
const SUB = '#555';
const FILLS = { white: '#ffffff', light: '#d9d9d9', mid: '#9a9a9a', black: '#222222' };
const CELL_FILLED = '#555555';
const R1 = (n) => Math.round(n * 10) / 10;

function svgDoc(w, h, body) {
  w = Math.ceil(w); h = Math.ceil(h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="${FONT}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}
function txt(x, y, s, { size = 12, weight = 400, fill = INK, anchor = 'middle', spacing = 0 } = {}) {
  const ls = spacing ? ` letter-spacing="${spacing}"` : '';
  return `<text x="${R1(x)}" y="${R1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${s}</text>`;
}
function seg(x1, y1, x2, y2, w = 1.8) {
  return `<line x1="${R1(x1)}" y1="${R1(y1)}" x2="${R1(x2)}" y2="${R1(y2)}" stroke="${INK}" stroke-width="${w}"/>`;
}
function arrow(x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
  const L = 8, W = 4.5;
  const bx = x2 - dx * L, by = y2 - dy * L, px = -dy, py = dx;
  return seg(x1, y1, bx + dx * 1, by + dy * 1) +
    `<polygon points="${R1(x2)},${R1(y2)} ${R1(bx + px * W)},${R1(by + py * W)} ${R1(bx - px * W)},${R1(by - py * W)}" fill="${INK}"/>`;
}

// 기호 아이콘: 모양으로 구분하고 채움색은 보조 수단으로만 쓴다.
function iconShape(sym, cx, cy, r) {
  const st = `fill="${FILLS[sym.fill]}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"`;
  switch (sym.shape) {
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.44 : r * 1.05;
        pts.push(`${R1(cx + rr * Math.cos(a))},${R1(cy + r * 0.08 + rr * Math.sin(a))}`);
      }
      return `<polygon points="${pts.join(' ')}" ${st}/>`;
    }
    case 'circle':
      return `<circle cx="${R1(cx)}" cy="${R1(cy)}" r="${R1(r * 0.86)}" ${st}/>`;
    case 'triangle':
      return `<polygon points="${R1(cx)},${R1(cy - r * 0.95)} ${R1(cx + r)},${R1(cy + r * 0.78)} ${R1(cx - r)},${R1(cy + r * 0.78)}" ${st}/>`;
    case 'square': {
      const h = r * 0.78;
      return `<rect x="${R1(cx - h)}" y="${R1(cy - h)}" width="${R1(2 * h)}" height="${R1(2 * h)}" ${st}/>`;
    }
    case 'hexagon': {
      const pts = [];
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; pts.push(`${R1(cx + r * Math.cos(a))},${R1(cy + r * 0.98 * Math.sin(a))}`); }
      return `<polygon points="${pts.join(' ')}" ${st}/>`;
    }
    case 'semicircle': {
      const rr = r * 0.98, base = cy + r * 0.42;
      return `<path d="M ${R1(cx - rr)} ${R1(base)} A ${R1(rr)} ${R1(rr)} 0 0 1 ${R1(cx + rr)} ${R1(base)} Z" ${st}/>`;
    }
    case 'diamond': {
      let s = `<polygon points="${R1(cx)},${R1(cy - r)} ${R1(cx + r)},${R1(cy)} ${R1(cx)},${R1(cy + r)} ${R1(cx - r)},${R1(cy)}" ${st}/>`;
      if (sym.glyph === 'dot') s += `<circle cx="${R1(cx)}" cy="${R1(cy)}" r="${R1(r * 0.2)}" fill="${INK}"/>`;
      if (sym.glyph === 'inner') {
        const q = r * 0.48;
        s += `<polygon points="${R1(cx)},${R1(cy - q)} ${R1(cx + q)},${R1(cy)} ${R1(cx)},${R1(cy + q)} ${R1(cx - q)},${R1(cy)}" fill="#ffffff" stroke="${INK}" stroke-width="1.6"/>`;
      }
      return s;
    }
    default:
      throw new Error('unknown shape ' + sym.shape);
  }
}
const iconSvg = (sym) => svgDoc(40, 40, iconShape(sym, 20, 20, sym.kind === 'C' ? 17 : 15));

/* 3×3 격자: 0 빈 칸, 1 채운 칸, 2 원 표시, 3 X 표시 */
function gridBody(g, x, y, cell) {
  let s = '';
  for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / 3), c = i % 3, v = g[i];
    const X = x + c * cell, Y = y + r * cell;
    s += `<rect x="${R1(X)}" y="${R1(Y)}" width="${cell}" height="${cell}" fill="${v === 1 ? CELL_FILLED : '#ffffff'}" stroke="${INK}" stroke-width="1.5"/>`;
    if (v === 2) s += `<circle cx="${R1(X + cell / 2)}" cy="${R1(Y + cell / 2)}" r="${R1(cell * 0.29)}" fill="#ffffff" stroke="${INK}" stroke-width="2"/>`;
    if (v === 3) {
      const d = cell * 0.25, mx = X + cell / 2, my = Y + cell / 2;
      s += `<path d="M ${R1(mx - d)} ${R1(my - d)} L ${R1(mx + d)} ${R1(my + d)} M ${R1(mx + d)} ${R1(my - d)} L ${R1(mx - d)} ${R1(my + d)}" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
    }
  }
  s += `<rect x="${R1(x)}" y="${R1(y)}" width="${cell * 3}" height="${cell * 3}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  return s;
}
const gridSvg = (g) => svgDoc(76, 76, gridBody(g, 8, 8, 20));

/* ------------------------------------------------------------------ */
/* 문자열 · 격자 연산                                                   */
/* ------------------------------------------------------------------ */
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIG = '0123456789';
const SAFE_LET = [...LET].filter((c) => c !== 'I' && c !== 'O'); // 숫자 1·0과 헷갈리는 I, O는 화면에 내지 않는다.
const isDig = (c) => c >= '0' && c <= '9';
const sh = (c, k) => (isDig(c) ? DIG[(((DIG.indexOf(c) + k) % 10) + 10) % 10] : LET[(((LET.indexOf(c) + k) % 26) + 26) % 26]);
const mapAll = (k) => (s) => [...s].map((c) => sh(c, k)).join('');
const mapPos = (pos, k) => (s) => [...s].map((c, i) => (pos.includes(i) ? sh(c, k) : c)).join('');
const mapDigits = (k) => (s) => [...s].map((c) => (isDig(c) ? sh(c, k) : c)).join('');
const perm = (p) => (s) => p.map((i) => s[i]).join('');
const digitsOf = (s) => [...s].filter(isDig).map(Number);
const VOWELS = 'AEIOU';

const gperm = (src) => (g) => {
  const o = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const [rr, cc] = src(r, c); o.push(g[rr * 3 + cc]); }
  return o;
};
const rotCW = gperm((r, c) => [2 - c, r]);
const rotCCW = gperm((r, c) => [c, 2 - r]);
const rot180 = gperm((r, c) => [2 - r, 2 - c]);
const mirLR = gperm((r, c) => [r, 2 - c]);
const mirUD = gperm((r, c) => [2 - r, c]);
const rowDown = gperm((r, c) => [(r + 2) % 3, c]);
const rowUp = gperm((r, c) => [(r + 1) % 3, c]);
const colRight = gperm((r, c) => [r, (c + 2) % 3]);
const transp = gperm((r, c) => [c, r]);
const antiTransp = gperm((r, c) => [2 - c, 2 - r]);
const invert = (g) => g.map((v) => (v === 0 ? 1 : v === 1 ? 0 : v));
const fillEmptyOnly = (g) => g.map((v) => (v === 0 ? 1 : v));

/* ------------------------------------------------------------------ */
/* 도메인(문자열 / 격자)                                                */
/* ------------------------------------------------------------------ */
const STR = {
  kind: 'str',
  box: { w: 96, h: 40 },
  same: (a, b) => a === b,
  key: (a) => a,
  ok: (a) => !/[IO]/.test(a),
  noun: '문자열',
};
const GRID = {
  kind: 'grid',
  box: { w: 60, h: 60 },
  same: (a, b) => a.join('') === b.join(''),
  key: (a) => a.join(''),
  ok: () => true,
  noun: '격자',
};
function posOf(g, v) { const i = g.indexOf(v); return i < 0 ? null : [Math.floor(i / 3) + 1, (i % 3) + 1]; }
const posTxt = (p) => (p ? `${p[0]}행 ${p[1]}열` : '없음');
const filledCount = (g) => g.filter((v) => v === 1).length;
function gridDesc(g) { return `원 ${posTxt(posOf(g, 2))}, X ${posTxt(posOf(g, 3))}, 채운 칸 ${filledCount(g)}개`; }
function gridDiff(a, b) { // a(틀린 결과)가 b(주어진 출력)와 어떻게 다른지
  const pa = posTxt(posOf(a, 2)), pb = posTxt(posOf(b, 2));
  if (pa !== pb) return `원 표시가 ${pa}에 놓여`;
  const xa = posTxt(posOf(a, 3)), xb = posTxt(posOf(b, 3));
  if (xa !== xb) return `X 표시가 ${xa}에 놓여`;
  if (filledCount(a) !== filledCount(b)) return `채운 칸이 ${filledCount(a)}개가 되어`;
  return '채운 칸의 배치가 달라져';
}

/* ------------------------------------------------------------------ */
/* 회차별 규칙(기호)                                                    */
/* ------------------------------------------------------------------ */
function makeSet(def) {
  const map = {};
  def.symbols.forEach((s) => { map[s.key] = s; s.kind = s.kind || 'T'; });
  return { ...def, map, tkeys: def.symbols.filter((s) => s.kind === 'T').map((s) => s.key), ckeys: def.symbols.filter((s) => s.kind === 'C').map((s) => s.key) };
}

const SET1 = makeSet({
  no: 1, dom: STR,
  title: '도식 규칙',
  intro: '각 기호는 4자리 문자열(알파벳 대문자와 숫자)을 아래 규칙에 따라 바꾼다. 도식에서는 화살표 방향을 따라 기호를 하나씩 차례대로 적용한다.',
  note: '※ 자리는 왼쪽부터 첫째·둘째·셋째·넷째로 센다. ※ 알파벳은 Z 다음이 A, 숫자는 9 다음이 0으로 순환한다. ※ 숫자 0·1과 헷갈리지 않도록 문항의 문자열에는 알파벳 I와 O가 나오지 않는다(알파벳 순서 자체는 26자 그대로다).',
  symbols: [
    { key: 'A', name: '검은 별', shape: 'star', fill: 'black', desc: '모든 문자를 다음 순서로 한 칸씩 옮긴다. (A→B, Z→A, 0→1, 9→0)', example: 'AZ09 → BA10',
      short: '모든 문자 +1', invShort: '모든 문자 −1', f: mapAll(1), inv: mapAll(-1),
      errs: [{ f: mapAll(-1), why: '검은 별을 앞 순서(−1)로 옮긴', how: '앞 순서(−1)로 옮긴' }] },
    { key: 'B', name: '흰 원', shape: 'circle', fill: 'white', desc: '문자의 순서를 거꾸로 뒤집는다.', example: 'AB12 → 21BA',
      short: '역순', invShort: '역순', f: perm([3, 2, 1, 0]), inv: perm([3, 2, 1, 0]),
      errs: [{ f: perm([3, 1, 2, 0]), why: '흰 원을 첫째·넷째 자리만 맞바꾸는 것으로 착각한', how: '첫째·넷째 자리만 맞바꾼' }] },
    { key: 'C', name: '회색 삼각형', shape: 'triangle', fill: 'mid', desc: '첫째와 둘째 자리를 맞바꾸고, 셋째와 넷째 자리를 맞바꾼다.', example: 'ABCD → BADC',
      short: '1·2, 3·4 자리 교환', invShort: '1·2, 3·4 자리 교환', f: perm([1, 0, 3, 2]), inv: perm([1, 0, 3, 2]),
      errs: [{ f: perm([2, 3, 0, 1]), why: '회색 삼각형을 앞 두 자리와 뒤 두 자리를 통째로 맞바꾸는 것으로 착각한', how: '앞 두 자리와 뒤 두 자리를 통째로 맞바꾼' }] },
    { key: 'D', name: '흰 사각형', shape: 'square', fill: 'white', desc: '맨 앞 문자를 맨 뒤로 보낸다.', example: 'ABCD → BCDA',
      short: '맨 앞 → 맨 뒤', invShort: '맨 뒤 → 맨 앞', f: perm([1, 2, 3, 0]), inv: perm([3, 0, 1, 2]),
      errs: [{ f: perm([3, 0, 1, 2]), why: '흰 사각형을 반대 방향(맨 뒤 → 맨 앞)으로 적용한', how: '맨 뒤 문자를 맨 앞으로 보낸' }] },
    { key: 'E', name: '검은 육각형', shape: 'hexagon', fill: 'black', desc: '홀수 번째(첫째·셋째) 자리의 문자만 다음 순서로 두 칸씩 옮긴다.', example: 'Y28K → A20K',
      short: '홀수 자리 +2', invShort: '홀수 자리 −2', f: mapPos([0, 2], 2), inv: mapPos([0, 2], -2),
      errs: [{ f: mapPos([1, 3], 2), why: '검은 육각형을 짝수 번째 자리에 적용한', how: '짝수 번째 자리를 옮긴' }, { f: mapPos([0, 2], 1), why: '검은 육각형에서 두 칸이 아니라 한 칸만 옮긴', how: '한 칸만 옮긴' }] },
  ],
});

const SET2 = makeSet({
  no: 2, dom: GRID,
  title: '도식 규칙',
  intro: '각 기호는 3×3 격자를 아래 규칙에 따라 바꾼다. 격자의 칸은 빈 칸, 채운 칸(어두운 칸), 원 표시 칸, X 표시 칸 네 가지이다. 도식에서는 화살표 방향을 따라 기호를 하나씩 차례대로 적용한다.',
  note: '※ 행은 위에서부터 1·2·3행, 열은 왼쪽부터 1·2·3열이다. ※ 회전·대칭·이동을 할 때 원과 X 표시는 칸과 함께 움직인다(두 표시는 돌리거나 뒤집어도 모양이 같다). ※ 색 반전은 빈 칸과 채운 칸만 바꾸고, 원·X 표시 칸은 그대로 둔다.',
  symbols: [
    { key: 'A', name: '검은 별', shape: 'star', fill: 'black', desc: '격자 전체를 시계 방향으로 90° 회전한다.', example: '1행 → 3열, 3행 → 1열 (시계 방향 90°)',
      short: '시계 방향 90° 회전', invShort: '반시계 방향 90° 회전', f: rotCW, inv: rotCCW,
      errs: [{ f: rotCCW, why: '검은 별을 반시계 방향으로 회전한', how: '반시계 방향으로 돌린' }, { f: rot180, why: '검은 별을 180° 회전한', how: '180° 돌린' }] },
    { key: 'B', name: '흰 삼각형', shape: 'triangle', fill: 'white', desc: '세로 가운데 줄을 기준으로 좌우를 뒤집는다(1열 ↔ 3열).', example: '1열 ↔ 3열, 2열은 그대로',
      short: '좌우 대칭', invShort: '좌우 대칭', f: mirLR, inv: mirLR,
      errs: [{ f: mirUD, why: '흰 삼각형을 상하 대칭으로 착각한', how: '위아래로 뒤집은' }] },
    { key: 'C', name: '회색 사각형', shape: 'square', fill: 'mid', desc: '채운 칸은 비우고 빈 칸은 채운다. 원·X 표시 칸은 그대로 둔다.', example: '채운 칸 ↔ 빈 칸, 표시 칸은 그대로',
      short: '색 반전', invShort: '색 반전', f: invert, inv: invert,
      errs: [{ f: fillEmptyOnly, why: '회색 사각형에서 빈 칸만 채우고 채운 칸은 비우지 않은', how: '빈 칸만 채운' }] },
    { key: 'D', name: '흰 육각형', shape: 'hexagon', fill: 'white', desc: '모든 행을 아래로 한 칸씩 옮긴다. 맨 아래 3행은 맨 위 1행 자리로 올라간다.', example: '1행 → 2행, 2행 → 3행, 3행 → 1행',
      short: '행을 아래로 한 칸 이동', invShort: '행을 위로 한 칸 이동', f: rowDown, inv: rowUp,
      errs: [{ f: rowUp, why: '흰 육각형에서 행을 위로 옮긴', how: '행을 위로 옮긴' }, { f: colRight, why: '흰 육각형에서 행 대신 열을 옮긴', how: '행 대신 열을 옮긴' }] },
    { key: 'E', name: '검은 반원', shape: 'semicircle', fill: 'black', desc: '왼쪽 위에서 오른쪽 아래로 가는 대각선을 기준으로 뒤집는다(행과 열을 맞바꾼다).', example: '1행 ↔ 1열, 2행 ↔ 2열, 3행 ↔ 3열',
      short: '주대각선 대칭', invShort: '주대각선 대칭', f: transp, inv: transp,
      errs: [{ f: antiTransp, why: '검은 반원을 반대쪽 대각선(오른쪽 위–왼쪽 아래) 기준 대칭으로 착각한', how: '반대쪽 대각선을 기준으로 뒤집은' }] },
  ],
});

const vowelTest = (s) => VOWELS.includes(s[0]);
const evenSumTest = (s) => digitsOf(s).reduce((a, b) => a + b, 0) % 2 === 0;
const SET3 = makeSet({
  no: 3, dom: STR,
  title: '도식 규칙',
  intro: '기호는 변환 기호 4개와 조건 기호(마름모) 2개로 이루어진다. 변환 기호는 4자리 문자열을 바꾸고, 조건 기호는 그 지점에 도착한 문자열을 검사해 조건에 맞으면 Yes 쪽, 맞지 않으면 No 쪽 화살표로 보낸다. 조건 기호는 문자열을 바꾸지 않는다.',
  note: '※ 자리는 왼쪽부터 첫째·둘째·셋째·넷째로 센다. ※ 알파벳은 A 앞이 Z, Z 다음이 A이고 숫자는 0 앞이 9, 9 다음이 0으로 순환한다. ※ 모음은 A, E, I, O, U이다. ※ 조건은 처음 입력이 아니라 마름모에 도착한 그 시점의 문자열로 판단한다. ※ 문항의 문자열에는 알파벳 I와 O가 나오지 않는다.',
  symbols: [
    { key: 'A', name: '검은 삼각형', shape: 'triangle', fill: 'black', desc: '모든 문자를 앞 순서로 한 칸씩 옮긴다. (B→A, A→Z, 1→0, 0→9)', example: 'BA10 → AZ09',
      short: '모든 문자 −1', invShort: '모든 문자 +1', f: mapAll(-1), inv: mapAll(1),
      errs: [{ f: mapAll(1), why: '검은 삼각형을 다음 순서(+1)로 옮긴', how: '다음 순서(+1)로 옮긴' }] },
    { key: 'B', name: '흰 원', shape: 'circle', fill: 'white', desc: '둘째와 셋째 자리를 맞바꾼다.', example: 'ABCD → ACBD',
      short: '2·3 자리 교환', invShort: '2·3 자리 교환', f: perm([0, 2, 1, 3]), inv: perm([0, 2, 1, 3]),
      errs: [{ f: perm([1, 0, 2, 3]), why: '흰 원을 첫째·둘째 자리 교환으로 착각한', how: '첫째·둘째 자리를 맞바꾼' }] },
    { key: 'C', name: '회색 사각형', shape: 'square', fill: 'mid', desc: '맨 뒤 문자를 맨 앞으로 보낸다.', example: 'ABCD → DABC',
      short: '맨 뒤 → 맨 앞', invShort: '맨 앞 → 맨 뒤', f: perm([3, 0, 1, 2]), inv: perm([1, 2, 3, 0]),
      errs: [{ f: perm([1, 2, 3, 0]), why: '회색 사각형을 반대 방향(맨 앞 → 맨 뒤)으로 적용한', how: '맨 앞 문자를 맨 뒤로 보낸' }] },
    { key: 'D', name: '검은 육각형', shape: 'hexagon', fill: 'black', desc: '숫자만 다음 순서로 한 칸씩 옮긴다(9→0). 알파벳은 그대로 둔다.', example: 'A9B3 → A0B4',
      short: '숫자만 +1', invShort: '숫자만 −1', f: mapDigits(1), inv: mapDigits(-1),
      errs: [{ f: mapAll(1), why: '검은 육각형을 알파벳까지 옮긴', how: '알파벳까지 옮긴' }, { f: mapDigits(-1), why: '검은 육각형에서 숫자를 앞 순서로 옮긴', how: '숫자를 앞 순서로 옮긴' }] },
    { key: 'E', name: '점 마름모', kind: 'C', shape: 'diamond', fill: 'white', glyph: 'dot',
      desc: '첫째 자리 문자가 모음(A, E, I, O, U)이면 Yes, 아니면 No 쪽으로 보낸다.', example: 'E7K2 → Yes, 7EK2 → No',
      short: '첫 문자 모음?', test: vowelTest,
      explain: (s) => (isDig(s[0]) ? `첫 문자 ${s[0]}은(는) 숫자` : `첫 문자 ${J.eun(s[0])} ${VOWELS.includes(s[0]) ? '모음' : '모음 아님'}`) },
    { key: 'F', name: '이중 마름모', kind: 'C', shape: 'diamond', fill: 'light', glyph: 'inner',
      desc: '문자열 속 숫자를 모두 더한 값이 짝수이면 Yes, 홀수이면 No 쪽으로 보낸다(숫자가 없으면 0으로 본다).', example: 'A3B5 → Yes(3+5=8), A3B4 → No(3+4=7)',
      short: '숫자 합 짝수?', test: evenSumTest,
      explain: (s) => { const d = digitsOf(s); const t = d.reduce((a, b) => a + b, 0); return `숫자 합 ${d.length > 1 ? d.join('+') + '=' : ''}${t}, ${t % 2 === 0 ? '짝수' : '홀수'}`; } },
  ],
});
// 점 마름모 설명의 '은(는)'을 실제 조사로 바꾼다.
SET3.map.E.explain = (s) => (isDig(s[0]) ? `첫 문자 ${J.eun(s[0])} 숫자(모음 아님)` : `첫 문자 ${J.eun(s[0])} ${VOWELS.includes(s[0]) ? '모음' : '모음 아님'}`);

/* ------------------------------------------------------------------ */
/* 프로그램(도식) 표현과 실행                                           */
/* prog = { pre: [step], cond: null | { key, yes: prog, no: prog } }   */
/* step = { key } | { slot: '?' | '가' | '나' | '㉠' }                  */
/* ------------------------------------------------------------------ */
const P = (pre, cond = null) => ({ pre: pre.map((k) => (typeof k === 'string' ? (k.length === 1 && /[A-Z]/.test(k) ? { key: k } : { slot: k }) : k)), cond });
const Cn = (key, yes, no) => ({ key, yes, no });
function cloneProg(p) {
  return { pre: p.pre.map((s) => ({ ...s })), cond: p.cond ? { ...p.cond, yes: cloneProg(p.cond.yes), no: cloneProg(p.cond.no) } : null };
}
function stepsOf(p, out = []) { p.pre.forEach((s) => out.push(s)); if (p.cond) { stepsOf(p.cond.yes, out); stepsOf(p.cond.no, out); } return out; }
function preArrays(p, out = []) { out.push(p.pre); if (p.cond) { preArrays(p.cond.yes, out); preArrays(p.cond.no, out); } return out; }
function condsOf(p, out = []) { if (p.cond) { out.push(p.cond); condsOf(p.cond.yes, out); condsOf(p.cond.no, out); } return out; }
const stepKey = (st, assign) => (st.slot ? assign?.[st.slot] : st.key);

function run(S, prog, x, opt = {}) {
  const trace = [];
  let cur = x, p = prog;
  for (;;) {
    for (const st of p.pre) {
      if (st.omit) continue;
      const key = stepKey(st, opt.assign);
      const sym = S.map[key];
      assert.ok(sym && sym.kind === 'T', `변환 기호가 아님: ${key}`);
      const nx = (st.fx || sym.f)(cur);
      trace.push({ t: 'T', key, before: cur, after: nx });
      cur = nx;
    }
    if (!p.cond) break;
    const c = p.cond, sym = S.map[c.key];
    const at = opt.condOnOrig ? x : cur;
    let res = sym.test(at);
    if (c.flip) res = !res;
    trace.push({ t: 'C', key: c.key, at, res });
    p = res ? c.yes : c.no;
  }
  return { out: cur, trace };
}
const symCount = (prog) => stepsOf(prog).length + condsOf(prog).length; // 그림에 그려진 기호 수
const pathCount = (trace) => trace.length; // 실제로 지나는 기호 수(변환 + 마름모)

/* ------------------------------------------------------------------ */
/* 흐름도 SVG                                                           */
/* ------------------------------------------------------------------ */
const GAP = 26, SYM_W = 40, SYM_R = 17, DIA_R = 23;

function drawData(dom, spec, x, cy, label) {
  const { w, h } = dom.box;
  let s = '';
  if (label) s += txt(x + w / 2, cy - h / 2 - 7, label, { size: 12, fill: SUB });
  if (spec.q) {
    s += `<rect x="${R1(x)}" y="${R1(cy - h / 2)}" width="${w}" height="${h}" rx="4" fill="#ffffff" stroke="${INK}" stroke-width="2"/>`;
    s += txt(x + w / 2, cy + 9, '?', { size: 26, weight: 700 });
  } else if (dom.kind === 'str') {
    s += `<rect x="${R1(x)}" y="${R1(cy - h / 2)}" width="${w}" height="${h}" rx="4" fill="#ffffff" stroke="${INK}" stroke-width="2"/>`;
    s += txt(x + w / 2 + 1, cy + 7.5, spec.v, { size: 21, weight: 700, spacing: 2 });
  } else {
    s += gridBody(spec.v, x, cy - h / 2, 20);
  }
  return s;
}
function drawStep(S, st, x, cy) {
  const cx = x + SYM_W / 2;
  if (!st.slot) return iconShape(S.map[st.key], cx, cy, SYM_R);
  let s = `<circle cx="${R1(cx)}" cy="${R1(cy)}" r="${SYM_R + 1}" fill="#ffffff" stroke="${INK}" stroke-width="1.8" stroke-dasharray="4 3"/>`;
  if (st.slot === '㉠') s += txt(cx, cy + 6.5, '㉠', { size: 18, weight: 700 });
  else s += txt(cx, cy + 7, '?', { size: 20, weight: 700 });
  if (st.slot === '가' || st.slot === '나') s += txt(cx, cy - SYM_R - 7, `(${st.slot})`, { size: 12, weight: 700 });
  return s;
}

// 한 줄(또는 갈래가 있는) 흐름도를 그린다. 반환: { body, w, h }
function flowBody(S, prog, inp, out, x0 = 10, yTop = 0) {
  const dom = S.dom;
  const { w: BW, h: BH } = dom.box;
  const hasSlotLabel = stepsOf(prog).some((s) => s.slot === '가' || s.slot === '나');
  const y0 = yTop + Math.max(BH / 2 + 22, hasSlotLabel ? 44 : 0);
  const LANE = dom.kind === 'grid' ? 100 : 80;
  const laneY = (i) => y0 + i * LANE;
  const parts = [];
  let maxLane = 0;
  parts.push(drawData(dom, inp, x0, y0, '입력'));
  function layout(p, xs, lane) {
    let cur = xs; const cy = laneY(lane);
    for (const st of p.pre) {
      parts.push(arrow(cur, cy, cur + GAP, cy)); cur += GAP;
      parts.push(drawStep(S, st, cur, cy)); cur += SYM_W;
    }
    if (!p.cond) return [{ x: cur, lane }];
    parts.push(arrow(cur, cy, cur + GAP, cy)); cur += GAP;
    const xd = cur + DIA_R;
    parts.push(iconShape(S.map[p.cond.key], xd, cy, DIA_R));
    cur += 2 * DIA_R;
    parts.push(txt(cur + 3, cy - 6, 'Yes', { size: 11, weight: 700, anchor: 'start' }));
    const yesEnds = layout(p.cond.yes, cur, lane);
    const noLane = ++maxLane;
    parts.push(seg(xd, cy + DIA_R, xd, laneY(noLane)));
    parts.push(txt(xd + 5, cy + DIA_R + 13, 'No', { size: 11, weight: 700, anchor: 'start' }));
    const noEnds = layout(p.cond.no, xd, noLane);
    return yesEnds.concat(noEnds);
  }
  const ends = layout(prog, x0 + BW, 0);
  const xOut = Math.max(...ends.map((e) => e.x)) + GAP + (ends.length > 1 ? 6 : 0);
  const busX = xOut + BW / 2;
  const lower = ends.filter((e) => e.lane > 0);
  for (const e of ends) {
    if (e.lane === 0) parts.push(arrow(e.x, y0, xOut, y0));
    else parts.push(seg(e.x, laneY(e.lane), busX, laneY(e.lane)));
  }
  if (lower.length) {
    const deepest = Math.max(...lower.map((e) => e.lane));
    parts.push(arrow(busX, laneY(deepest), busX, y0 + BH / 2));
    for (const e of lower) if (e.lane < deepest) parts.push(`<circle cx="${R1(busX)}" cy="${R1(laneY(e.lane))}" r="3" fill="${INK}"/>`);
  }
  parts.push(drawData(dom, out, xOut, y0, '출력'));
  const w = xOut + BW + 10;
  const h = (maxLane > 0 ? laneY(maxLane) + 22 : y0 + BH / 2 + 10) - yTop;
  return { body: parts.join(''), w, h };
}
function flowSvg(S, prog, inp, out) {
  const f = flowBody(S, prog, inp, out);
  return svgDoc(f.w, f.h, f.body);
}
function twoRowSvg(S, rows) {
  let body = '', y = 0, w = 0;
  rows.forEach((r, i) => {
    const f = flowBody(S, r.prog, r.inp, r.out, 44, y);
    const cy = y + Math.max(S.dom.box.h / 2 + 22, 0);
    body += txt(20, cy + 5, r.label, { size: 15, weight: 700 }) + f.body;
    if (i < rows.length - 1) body += `<line x1="8" y1="${R1(y + f.h + 4)}" x2="${R1(f.w)}" y2="${R1(y + f.h + 4)}" stroke="#bbbbbb" stroke-width="1" stroke-dasharray="3 3"/>`;
    y += f.h + 8; w = Math.max(w, f.w);
  });
  return svgDoc(w, y - 4, body);
}
function symbolChoiceSvg(sym) {
  return svgDoc(110, 74, iconShape(sym, 55, 28, 18) + txt(55, 66, sym.name, { size: 13, weight: 700 }));
}
function pairChoiceSvg(S, a, b) {
  const one = (cx, label, sym) => txt(cx, 15, label, { size: 12, weight: 700, fill: SUB }) + iconShape(sym, cx, 40, 15) + txt(cx, 74, sym.name, { size: 12, weight: 700 });
  return svgDoc(200, 82, one(50, '(가)', S.map[a]) + seg(100, 10, 100, 72, 1) + one(150, '(나)', S.map[b]));
}
function exampleGridSvg(sym, g) {
  const after = sym.f(g);
  const body = gridBody(g, 8, 8, 18) + arrow(68, 35, 88, 35) + iconShape(sym, 106, 35, 15) + arrow(124, 35, 144, 35) + gridBody(after, 148, 8, 18);
  return svgDoc(210, 70, body);
}

/* ------------------------------------------------------------------ */
/* 입력 생성                                                            */
/* ------------------------------------------------------------------ */
function randStr(rng, { minDig = 1, maxDig = 3 } = {}) {
  for (;;) {
    const nd = minDig + rng.int(maxDig - minDig + 1);
    const kinds = rng.shuffle([...Array(nd).fill('d'), ...Array(4 - nd).fill('l')]);
    const s = kinds.map((k) => (k === 'd' ? rng.pick([...DIG]) : rng.pick(SAFE_LET))).join('');
    if (new Set(s).size === 4) return s;
  }
}
function randGrid(rng) {
  for (;;) {
    const g = Array(9).fill(0);
    const idx = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const nf = 3 + rng.int(2);
    idx.slice(0, nf).forEach((i) => { g[i] = 1; });
    g[idx[nf]] = 2; g[idx[nf + 1]] = 3;
    if (g[4] === 2 || g[4] === 3) continue; // 표시가 가운데에 있으면 회전·대칭으로 위치가 안 변한다.
    const imgs = [rotCW, rotCCW, rot180, mirLR, mirUD, transp, antiTransp, rowDown, rowUp, colRight].map((f) => f(g).join(''));
    if (imgs.includes(g.join(''))) continue; // 대칭인 격자는 쓰지 않는다.
    return g;
  }
}

/* ------------------------------------------------------------------ */
/* 오답 후보                                                            */
/* ------------------------------------------------------------------ */
function forwardCands(S, prog, x, assign) {
  const cands = [];
  const steps = stepsOf(prog);
  steps.forEach((st0, i) => {
    const key = stepKey(st0, assign);
    const sym = S.map[key];
    { const p = cloneProg(prog); stepsOf(p)[i].omit = true; cands.push({ kind: 'omit', val: run(S, p, x, { assign }).out, why: `${J.eul(sym.name)} 빠뜨린` }); }
    for (const e of sym.errs || []) { const p = cloneProg(prog); stepsOf(p)[i].fx = e.f; cands.push({ kind: 'err', val: run(S, p, x, { assign }).out, why: e.why }); }
    for (const k of S.tkeys) {
      if (k === key) continue;
      const p = cloneProg(prog); const s = stepsOf(p)[i]; delete s.slot; s.key = k;
      cands.push({ kind: 'confuse', val: run(S, p, x, { assign }).out, why: `${sym.name} 대신 ${J.eul(S.map[k].name)} 적용한` });
    }
  });
  preArrays(prog).forEach((arr, ai) => {
    for (let j = 0; j + 1 < arr.length; j++) {
      const a = stepKey(arr[j], assign), b = stepKey(arr[j + 1], assign);
      if (a === b) continue;
      const p = cloneProg(prog); const arr2 = preArrays(p)[ai];
      [arr2[j], arr2[j + 1]] = [arr2[j + 1], arr2[j]];
      cands.push({ kind: 'swap', val: run(S, p, x, { assign }).out, why: `${J.wa(S.map[a].name)} ${S.map[b].name}의 순서를 바꿔 적용한` });
    }
  });
  condsOf(prog).forEach((c0, i) => {
    const p = cloneProg(prog); condsOf(p)[i].flip = true;
    cands.push({ kind: 'flip', val: run(S, p, x, { assign }).out, why: `${S.map[c0.key].name}의 판정을 반대로 하여 다른 갈래로 간` });
  });
  if (condsOf(prog).length) cands.push({ kind: 'orig', val: run(S, prog, x, { assign, condOnOrig: true }).out, why: '마름모 조건을 그 지점의 문자열이 아니라 처음 입력으로 판단한' });
  return cands;
}

function pickDistractors(rng, cands, answer, dom, kindOrder, n = 4) {
  const seen = new Set([dom.key(answer)]);
  const byKind = {};
  for (const k of kindOrder) byKind[k] = rng.shuffle(cands.filter((c) => c.kind === k));
  const out = [];
  let progress = true;
  while (out.length < n && progress) {
    progress = false;
    for (const k of kindOrder) {
      if (out.length >= n) break;
      const list = byKind[k];
      while (list.length) {
        const c = list.shift();
        const key = dom.key(c.val);
        if (seen.has(key) || !dom.ok(c.val)) continue;
        seen.add(key); out.push(c); progress = true; break;
      }
    }
  }
  return out;
}
function place(rng, ansVal, ds, target) {
  const others = rng.shuffle(ds);
  const vals = [], whys = [], kinds = [];
  let k = 0;
  for (let i = 1; i <= 5; i++) {
    if (i === target) { vals.push(ansVal); whys.push(null); kinds.push('answer'); }
    else { vals.push(others[k].val); whys.push(others[k].why); kinds.push(others[k].kind); k++; }
  }
  return { vals, whys, kinds };
}

/* ------------------------------------------------------------------ */
/* 해설 문장                                                            */
/* ------------------------------------------------------------------ */
function traceText(S, x, trace, outLabel) {
  const dom = S.dom;
  if (dom.kind === 'str') {
    let s = x;
    for (const t of trace) {
      if (t.t === 'T') s += ` → (${S.map[t.key].name}: ${S.map[t.key].short}) → ${t.after}`;
      else s += ` → (${S.map[t.key].name}: ${S.map[t.key].explain(t.at)} → <b>${t.res ? 'Yes' : 'No'}</b>)`;
    }
    return s;
  }
  // 격자: 기호 순서와 표시 위치 추적
  let s = '입력';
  for (const t of trace) s += ` → (${S.map[t.key].name}: ${S.map[t.key].short})`;
  s += ` → ${outLabel || '출력'}`;
  const states = [x, ...trace.filter((t) => t.t === 'T').map((t) => t.after)];
  s += `<br>· 원 표시: ${states.map((g) => posTxt(posOf(g, 2))).join(' → ')}`;
  s += `<br>· X 표시: ${states.map((g) => posTxt(posOf(g, 3))).join(' → ')}`;
  s += `<br>· 채운 칸 수: ${states.map((g) => filledCount(g) + '개').join(' → ')}`;
  return s;
}
function invTraceText(S, out, tsteps) {
  // tsteps: 실행된 변환 단계(앞→뒤). 뒤에서부터 되돌린다.
  let s = S.dom.kind === 'str' ? out : '출력';
  for (let i = tsteps.length - 1; i >= 0; i--) {
    const t = tsteps[i], sym = S.map[t.key];
    s += ` → (${sym.name} 되돌리기: ${sym.invShort}) → ${S.dom.kind === 'str' ? t.before : (i === 0 ? '입력' : '')}`;
  }
  return S.dom.kind === 'str' ? s : s.replace(/ → (?= →)/g, '').replace(/ → $/, '');
}
const valTxt = (S, v) => (S.dom.kind === 'str' ? v : gridDesc(v));
function wrongLine(S, i, why, kindNoun) {
  return `${CIRC_EUN[i]} ${why} ${kindNoun}이다.`;
}

/* ------------------------------------------------------------------ */
/* 문항 생성기                                                          */
/* ------------------------------------------------------------------ */
function chooseKeys(rng, S, n, usage, fixed = {}) {
  // 한 도식 안에서는 같은 기호를 되도록 다시 쓰지 않고(기호 수가 모자라면 인접한 것만 피함),
  // 회차 안에서 덜 쓰인 기호를 조금 더 자주 뽑는다.
  const keys = [];
  const distinct = n <= S.tkeys.length;
  const fixedVals = Object.values(fixed);
  for (let i = 0; i < n; i++) {
    if (fixed[i]) { keys.push(fixed[i]); continue; }
    const pool = S.tkeys.filter((k) => k !== keys[i - 1] && k !== fixed[i + 1] && (!distinct || (!keys.includes(k) && !fixedVals.includes(k))));
    keys.push(rng.weighted(pool, (k) => 1 / (1 + (usage[k] || 0)) ** 2));
  }
  return keys;
}
function traceOk(S, x, res) {
  const dom = S.dom;
  if (!dom.ok(x) || !dom.ok(res.out)) return false;
  if (dom.same(x, res.out)) return false;
  for (const t of res.trace) {
    if (t.t !== 'T') continue;
    if (dom.same(t.before, t.after)) return false; // 아무 변화가 없는 단계는 쓰지 않는다.
    if (!dom.ok(t.after)) return false;
  }
  return true;
}
const randInput = (rng, S) => (S.dom.kind === 'str' ? randStr(rng) : randGrid(rng));
const stemFwd = (S) => `다음 도식에서 '?'에 들어갈 ${S.dom.noun}로 알맞은 것은?`;

function choicesField(S, vals) {
  return S.dom.kind === 'str' ? { choices: vals.slice() } : { choiceSvgs: vals.map(gridSvg) };
}

// 순방향 변환(조건 분기 포함 가능)
function buildForward(ctx, { makeProg, subtype, require, kindOrder, stem }) {
  const { rng, S } = ctx;
  for (let att = 0; att < MAX_ITEM_ATTEMPTS; att++) {
    const prog = makeProg();
    const x = randInput(rng, S);
    if (ctx.usedInputs.has(S.dom.key(x))) continue;
    const res = run(S, prog, x);
    if (!traceOk(S, x, res)) continue;
    if (require && !require(res, prog, x)) continue;
    const cands = forwardCands(S, prog, x, {});
    const ds = pickDistractors(rng, cands.filter((c) => !S.dom.same(c.val, x)), res.out, S.dom, kindOrder || ['omit', 'swap', 'err', 'confuse']);
    if (ds.length < 4) continue;
    if (require?.distractors && !require.distractors(ds)) continue;
    const { vals, whys } = place(rng, res.out, ds, ctx.target);
    // 검증: 계산값과 일치하는 선지가 정확히 1개
    const hits = vals.map((v, i) => (S.dom.same(v, res.out) ? i + 1 : 0)).filter(Boolean);
    assert.deepEqual(hits, [ctx.target], '순방향: 정답 선지가 하나가 아님');
    assert.equal(new Set(vals.map(S.dom.key)).size, 5, '선지 중복');
    ctx.usedInputs.add(S.dom.key(x));
    const noun = S.dom.kind === 'str' ? '결과' : '모양';
    const ansTxt = S.dom.kind === 'str' ? `${res.out}(${CIRC[ctx.target - 1]})` : `${CIRC[ctx.target - 1]}`;
    let ex = `<b>풀이</b> ${traceText(S, x, res.trace)}<br>따라서 '?'에 들어갈 ${S.dom.noun}${S.dom.kind === 'str' ? '은' : '는'} ${ansTxt}이다.`;
    ex += '<br><b>오답</b> ' + whys.map((w, i) => (w ? wrongLine(S, i, w, noun) : null)).filter(Boolean).join(' ');
    return {
      item: {
        subtype: subtype || '순방향 변환',
        stem: stem || stemFwd(S),
        figure: { svg: flowSvg(S, prog, { v: x }, { q: true }), caption: condsOf(prog).length ? '마름모에서는 조건에 맞으면 Yes, 아니면 No 방향으로 간다.' : '' },
        ...choicesField(S, vals),
        answer: ctx.target,
        explanation: ex,
      },
      meta: { type: 'forward', prog, x, out: res.out, vals, nsym: symCount(prog), npath: pathCount(res.trace), path: res.trace.filter((t) => t.t === 'C').map((t) => (t.res ? 'Y' : 'N')).join('') },
    };
  }
  throw new Error(`순방향 문항 생성 실패(set ${S.no}, target ${ctx.target})`);
}

// 빠진 기호 추론(1·2회): '?' 한 칸, 선지 = 기호 5개(규칙표 순서)
function buildMissing(ctx, { n }) {
  const { rng, S } = ctx;
  assert.equal(S.tkeys.length, 5, '빠진 기호 선지는 변환 기호 5개를 그대로 쓴다');
  const hidden = S.tkeys[ctx.target - 1];
  for (let att = 0; att < MAX_ITEM_ATTEMPTS; att++) {
    const slotPos = rng.int(n);
    const keys = chooseKeys(rng, S, n, ctx.usage, { [slotPos]: hidden });
    const prog = P(keys.map((k, i) => (i === slotPos ? '?' : k)));
    const x = randInput(rng, S);
    if (ctx.usedInputs.has(S.dom.key(x))) continue;
    const res = run(S, prog, x, { assign: { '?': hidden } });
    if (!traceOk(S, x, res)) continue;
    const outs = S.tkeys.map((k) => run(S, prog, x, { assign: { '?': k } }).out);
    const hits = outs.map((o, i) => (S.dom.same(o, res.out) ? i + 1 : 0)).filter(Boolean);
    if (hits.length !== 1) continue; // 정답 유일성
    if (!outs.every((o) => S.dom.ok(o))) continue;
    assert.deepEqual(hits, [ctx.target]);
    ctx.usedInputs.add(S.dom.key(x));
    // 해설
    const tsteps = res.trace;
    const before = tsteps[slotPos].before, after = tsteps[slotPos].after;
    const sym = S.map[hidden];
    const preTrace = tsteps.slice(0, slotPos), postTrace = tsteps.slice(slotPos + 1);
    let ex = '<b>풀이</b> ';
    if (S.dom.kind === 'str') {
      ex += preTrace.length
        ? `입력 ${x}에 '?' 앞의 기호를 적용하면 ${traceText(S, x, preTrace)}이다. `
        : `'?'에는 입력 ${x}가 그대로 들어간다. `;
      ex += postTrace.length
        ? `출력 ${res.out}에서 '?' 뒤의 기호를 거꾸로 되돌리면 ${invTraceText(S, res.out, postTrace)}이다. `
        : `'?'를 지난 결과가 곧 출력 ${res.out}이다. `;
      ex += `따라서 '?'는 ${before}를 ${after}로 바꾸는 기호, 곧 <b>${sym.name}</b>(${sym.short}, ${CIRC[ctx.target - 1]})이다.`;
      ex += '<br><b>오답</b> 다른 기호를 넣으면 출력이 달라진다. ' + S.tkeys.map((k, i) => (k === hidden ? null : `${S.map[k].name} → ${outs[i]}`)).filter(Boolean).join(', ') + '.';
    } else {
      ex += `'?' 바로 앞의 격자(${gridDesc(before)})와 '?' 바로 뒤의 격자(${gridDesc(after)})를 비교한다. `;
      ex += preTrace.length ? `앞쪽은 입력에 ${preTrace.map((t) => S.map[t.key].name).join(', ')}을(를) 차례로 적용해 얻고, ` : `앞쪽은 입력 그대로이고, `;
      ex += postTrace.length ? `뒤쪽은 출력에서 ${postTrace.slice().reverse().map((t) => `${S.map[t.key].name}(${S.map[t.key].invShort})`).join(', ')}의 순서로 되돌려 얻는다. ` : '뒤쪽은 출력 그대로이다. ';
      ex += `이 변화를 만드는 기호는 <b>${sym.name}</b>(${sym.short}, ${CIRC[ctx.target - 1]})뿐이다.`;
      ex += `<br>검산: ${traceText(S, x, tsteps)}`;
      ex += '<br><b>오답</b> ' + S.tkeys.map((k, i) => (k === hidden ? null : `${S.map[k].name}을(를) 넣으면 ${gridDiff(outs[i], res.out)} 출력과 다르다.`)).filter(Boolean).join(' ');
      ex = ex.replace(/([가-힣]+)을\(를\)/g, (m, w) => J.eul(w));
    }
    ex = ex.replace(/([A-Z0-9]{4})를 ([A-Z0-9]{4})로/, (m, a, b) => `${J.eul(a)} ${J.ro(b)}`);
    ex = ex.replace(/입력 ([A-Z0-9]{4})가 그대로/, (m, a) => `입력 ${J.ga(a)} 그대로`);
    return {
      item: {
        subtype: '빠진 기호 추론',
        stem: "다음 도식에서 '?'에 들어갈 기호로 알맞은 것은?",
        figure: { svg: flowSvg(S, prog, { v: x }, { v: res.out }), caption: '' },
        choiceSvgs: S.tkeys.map((k) => symbolChoiceSvg(S.map[k])),
        answer: ctx.target,
        explanation: ex,
      },
      meta: { type: 'missing', prog, x, out: res.out, hidden, nsym: symCount(prog) },
    };
  }
  throw new Error(`빠진 기호 문항 생성 실패(set ${S.no})`);
}

// 빠진 기호 추론(3회): (가)·(나) 두 칸, 선지 = 기호 쌍
function buildMissingPair(ctx, { makeProg, require }) {
  const { rng, S } = ctx;
  const combos = [];
  for (const a of S.tkeys) for (const b of S.tkeys) combos.push([a, b]);
  for (let att = 0; att < MAX_ITEM_ATTEMPTS; att++) {
    const [a, b] = rng.pick(combos);
    if (a === b || ctx.usedPairs.has(a + b)) continue; // 같은 기호 두 번, 앞 문항과 같은 정답 쌍은 피한다.
    const prog = makeProg();
    const x = randInput(rng, S);
    if (ctx.usedInputs.has(S.dom.key(x))) continue;
    const res = run(S, prog, x, { assign: { 가: a, 나: b } });
    if (!traceOk(S, x, res)) continue;
    if (!res.trace.some((t) => t.t === 'T' && t.key === b)) continue;
    if (require && !require(res)) continue;
    const outs = combos.map(([p, q]) => run(S, prog, x, { assign: { 가: p, 나: q } }).out);
    const hits = combos.filter((c, i) => outs[i] === res.out);
    if (hits.length !== 1) continue; // 16가지 조합 중 하나만 맞아야 한다.
    // 오답 쌍: 순서를 바꾼 쌍 → 한쪽만 같은 쌍 → 나머지
    const rank = ([p, q]) => (p === b && q === a ? 0 : p === a || q === b ? 1 : 2);
    const wrong = rng.shuffle(combos.filter(([p, q]) => !(p === a && q === b))).sort((u, v) => rank(u) - rank(v));
    const picked = [];
    for (const pass of [0, 1]) { // 1차: 출력이 서로 다른 오답만, 2차: 모자라면 출력이 겹쳐도 허용
      for (const c of wrong) {
        if (picked.length === 4) break;
        const o = outs[combos.indexOf(c)];
        if (!S.dom.ok(o) || picked.some((p) => p.val === c)) continue;
        if (pass === 0 && picked.some((p) => p.out === o)) continue;
        picked.push({ val: c, why: null, out: o });
      }
    }
    if (picked.length < 4) continue;
    const { vals } = place(rng, [a, b], picked, ctx.target);
    const outsByChoice = vals.map(([p, q]) => run(S, prog, x, { assign: { 가: p, 나: q } }).out);
    const ok = outsByChoice.map((o, i) => (o === res.out ? i + 1 : 0)).filter(Boolean);
    assert.deepEqual(ok, [ctx.target], '빠진 기호 쌍: 정답 선지가 하나가 아님');
    ctx.usedInputs.add(S.dom.key(x));
    ctx.usedPairs.add(a + b);
    let ex = `<b>풀이</b> (가)에 <b>${S.map[a].name}</b>, (나)에 <b>${S.map[b].name}</b>을(를) 넣으면 ${traceText(S, x, res.trace)}로 주어진 출력과 같다. 가능한 16가지 조합 가운데 출력이 ${res.out}가 되는 조합은 이것 하나뿐이다(${CIRC[ctx.target - 1]}).`;
    ex = ex.replace(/<b>([가-힣 ]+)<\/b>을\(를\)/, (m, w) => `<b>${w}</b>${jong(w) ? '을' : '를'}`);
    ex = ex.replace(/출력이 ([A-Z0-9]{4})가 되는/, (m, s) => `출력이 ${J.ga(s)} 되는`);
    const lines = vals.map(([p, q], i) => (i + 1 === ctx.target ? null : `${CIRC_EUN[i]} 출력이 ${outsByChoice[i]}${p === b && q === a ? '(두 기호의 순서를 바꾼 경우)' : ''}`)).filter(Boolean);
    const lastOut = outsByChoice[vals.map((v, i) => i).filter((i) => i + 1 !== ctx.target).pop()];
    ex += `<br><b>오답</b> ${lines.join(', ')}${jong(lastOut) ? '이' : '가'} 되어 주어진 출력과 다르다.`;
    ex += '<br><b>요령</b> 숫자·알파벳 값만 바꾸는 기호(검은 삼각형, 검은 육각형)와 자리만 바꾸는 기호(흰 원, 회색 사각형)를 나눠 생각하면 후보가 빨리 줄어든다. 마름모가 있으면 (가)에 따라 갈래가 달라지는지 먼저 확인한다.';
    return {
      item: {
        subtype: '빠진 기호 추론',
        stem: '다음 도식의 (가), (나)에 들어갈 기호를 순서대로 바르게 짝지은 것은?',
        figure: { svg: flowSvg(S, prog, { v: x }, { v: res.out }), caption: condsOf(prog).length ? '마름모에서는 조건에 맞으면 Yes, 아니면 No 방향으로 간다.' : '' },
        choiceSvgs: vals.map(([p, q]) => pairChoiceSvg(S, p, q)),
        answer: ctx.target,
        explanation: ex,
      },
      meta: { type: 'pair', prog, x, out: res.out, pair: [a, b], vals, nsym: symCount(prog) },
    };
  }
  throw new Error(`빠진 기호(쌍) 문항 생성 실패(set ${S.no})`);
}

// 역방향 추론: 출력을 주고 입력을 고른다.
function buildReverse(ctx, { makeProg, require }) {
  const { rng, S } = ctx;
  const dom = S.dom;
  for (let att = 0; att < MAX_ITEM_ATTEMPTS; att++) {
    const prog = makeProg();
    const x = randInput(rng, S);
    if (ctx.usedInputs.has(dom.key(x))) continue;
    const res = run(S, prog, x);
    if (!traceOk(S, x, res)) continue;
    if (require && !require(res)) continue;
    const Y = res.out;
    const ts = res.trace.filter((t) => t.t === 'T');
    const k = ts.length;
    const syms = ts.map((t) => S.map[t.key]);
    const cands = [];
    const applyInv = (fs, v) => fs.reduce((acc, f) => f(acc), v);
    // 정답: inv_k, …, inv_1 순서
    const invSeq = syms.slice().reverse().map((s) => s.inv);
    assert.ok(dom.same(applyInv(invSeq, Y), x), '역변환 검산 실패');
    cands.push({ kind: 'order', val: applyInv(syms.map((s) => s.inv), Y), why: '되돌리는 순서를 거꾸로(첫 기호부터) 한' });
    cands.push({ kind: 'fwd', val: applyInv(syms.map((s) => s.f), Y), why: '출력에 도식의 기호를 처음부터 그대로 다시 적용한' });
    for (let i = 0; i < k; i++) {
      const seq = invSeq.slice(); seq.splice(k - 1 - i, 1);
      cands.push({ kind: 'omit', val: applyInv(seq, Y), why: `되돌릴 때 ${J.eul(syms[i].name)} 빠뜨린` });
      if (syms[i].inv !== syms[i].f && dom.key(syms[i].inv(Y)) !== dom.key(syms[i].f(Y))) {
        const seq2 = invSeq.slice(); seq2[k - 1 - i] = syms[i].f;
        cands.push({ kind: 'nofinv', val: applyInv(seq2, Y), why: `${J.eul(syms[i].name)} 되돌리지 않고 그대로 한 번 더 적용한` });
      }
      for (const e of syms[i].errs || []) {
        const seq3 = invSeq.slice(); seq3[k - 1 - i] = e.f;
        cands.push({ kind: 'errinv', val: applyInv(seq3, Y), why: `${J.eul(syms[i].name)} 되돌릴 때 ${e.how}` });
      }
    }
    // 반대쪽 갈래를 지났다고 보고 거꾸로 계산
    const conds = condsOf(prog);
    if (conds.length) {
      for (let ci = 0; ci < conds.length; ci++) {
        const p2 = cloneProg(prog); condsOf(p2)[ci].flip = true;
        const alt = run(S, p2, x); // 다른 갈래의 기호열
        const altSyms = alt.trace.filter((t) => t.t === 'T').map((t) => S.map[t.key]);
        const v = applyInv(altSyms.slice().reverse().map((s) => s.inv), Y);
        cands.push({ kind: 'branch', val: v, why: `${S.map[conds[ci].key].name}에서 반대쪽 갈래를 지났다고 보고 거꾸로 계산한` });
      }
    }
    const validWrong = cands.filter((c) => !dom.same(c.val, Y) && !dom.same(run(S, prog, c.val).out, Y)); // 출력 자체가 아니고, 넣어 봐도 출력이 다른 것만
    const order = conds.length ? ['branch', 'order', 'nofinv', 'omit', 'errinv', 'fwd'] : ['order', 'nofinv', 'omit', 'fwd', 'errinv'];
    const ds = pickDistractors(rng, validWrong, x, dom, order);
    if (ds.length < 4) continue;
    if (conds.length && !ds.some((d) => d.kind === 'branch')) continue; // 갈래를 잘못 고른 오답은 꼭 넣는다.
    const { vals, whys } = place(rng, x, ds, ctx.target);
    const fwdOuts = vals.map((v) => run(S, prog, v));
    const hits = fwdOuts.map((r, i) => (dom.same(r.out, Y) ? i + 1 : 0)).filter(Boolean);
    assert.deepEqual(hits, [ctx.target], '역방향: 출력과 일치하는 선지가 하나가 아님');
    if (!fwdOuts.every((r) => dom.ok(r.out) && r.trace.every((t) => t.t !== 'T' || dom.ok(t.after)))) continue;
    ctx.usedInputs.add(dom.key(x));
    let ex = '<b>풀이</b> ';
    if (dom.kind === 'str') {
      ex += `출력 ${Y}에서 기호를 뒤에서부터 거꾸로 되돌린다: ${invTraceText(S, Y, ts)}.`;
      if (conds.length) {
        const c = res.trace.find((t) => t.t === 'C');
        ex += ` 이때 마름모에 도착하는 문자열 ${c.at}는 ${S.map[c.key].explain(c.at)}이므로 ${c.res ? 'Yes' : 'No'} 갈래를 지난다는 가정과 맞는다.`;
        ex = ex.replace(/문자열 ([A-Z0-9]{4})는/, (m, s) => `문자열 ${J.eun(s)}`);
      }
      ex += `<br>검산: ${traceText(S, x, res.trace)}. 따라서 입력은 ${x}(${CIRC[ctx.target - 1]})이다.`;
      ex += '<br><b>오답</b> ' + vals.map((v, i) => (i + 1 === ctx.target ? null : `${CIRC_EUN[i]} ${whys[i]} 값으로, 넣어 보면 출력이 ${fwdOuts[i].out}${conds.length ? `(${fwdOuts[i].trace.filter((t) => t.t === 'C').map((t) => (t.res ? 'Yes' : 'No')).join('·')} 갈래)` : ''}가 된다.`)).filter(Boolean).join(' ');
    } else {
      ex += `출력 격자에서 기호를 뒤에서부터 거꾸로 되돌린다: ${invTraceText(S, Y, ts)}.`;
      ex += `<br>검산: ${traceText(S, x, res.trace)}<br>따라서 입력 격자는 ${CIRC[ctx.target - 1]}이다.`;
      ex += '<br><b>오답</b> ' + vals.map((v, i) => (i + 1 === ctx.target ? null : `${CIRC_EUN[i]} ${whys[i]} 격자로, 넣어 보면 ${gridDiff(fwdOuts[i].out, Y)} 출력과 다르다.`)).filter(Boolean).join(' ');
    }
    ex = ex.replace(/출력이 ([A-Z0-9]{4})(\([^)]*\))?가 된다/g, (m, s, p) => `출력이 ${s}${p || ''}${jong(s) ? '이' : '가'} 된다`);
    const stem = dom.kind === 'str'
      ? `다음 도식의 출력이 ${Y}일 때, '?'에 들어갈 입력으로 알맞은 것은?`
      : "다음 도식의 출력 격자가 그림과 같을 때, '?'에 들어갈 입력 격자로 알맞은 것은?";
    return {
      item: {
        subtype: '역방향 추론',
        stem: stem.replace(/출력이 ([A-Z0-9]{4})일/, (m, s) => `출력이 ${s}일`),
        figure: { svg: flowSvg(S, prog, { q: true }, { v: Y }), caption: conds.length ? '마름모에서는 조건에 맞으면 Yes, 아니면 No 방향으로 간다.' : '' },
        ...choicesField(S, vals),
        answer: ctx.target,
        explanation: ex,
      },
      meta: { type: 'reverse', prog, x, out: Y, vals, nsym: symCount(prog) },
    };
  }
  throw new Error(`역방향 문항 생성 실패(set ${S.no})`);
}

// 복합 변환(1·2회): (가)에서 ㉠을 찾아 (나)에 적용
function buildCompound(ctx) {
  const { rng, S } = ctx;
  const dom = S.dom;
  for (let att = 0; att < MAX_ITEM_ATTEMPTS; att++) {
    const h = rng.weighted(S.tkeys, (k) => 1 / (1 + (ctx.usage[k] || 0)) ** 2);
    const aFirst = rng.int(2) === 0;
    const ka = chooseKeys(rng, S, 2, ctx.usage, aFirst ? { 0: h } : { 1: h });
    const progA = P(ka.map((k, i) => ((aFirst ? i === 0 : i === 1) ? '㉠' : k)));
    const posB = rng.int(3);
    const kb = chooseKeys(rng, S, 3, ctx.usage, { [posB]: h });
    const progB = P(kb.map((k, i) => (i === posB ? '㉠' : k)));
    const xa = randInput(rng, S), xb = randInput(rng, S);
    if (dom.same(xa, xb) || ctx.usedInputs.has(dom.key(xa)) || ctx.usedInputs.has(dom.key(xb))) continue;
    const ra = run(S, progA, xa, { assign: { '㉠': h } });
    const rb = run(S, progB, xb, { assign: { '㉠': h } });
    if (!traceOk(S, xa, ra) || !traceOk(S, xb, rb)) continue;
    const outsA = S.tkeys.map((k) => run(S, progA, xa, { assign: { '㉠': k } }).out);
    if (outsA.filter((o) => dom.same(o, ra.out)).length !== 1) continue; // ㉠이 유일하게 정해져야 한다.
    const cands = S.tkeys.filter((k) => k !== h).map((k) => ({ kind: 'slot', val: run(S, progB, xb, { assign: { '㉠': k } }).out, why: `㉠을 ${J.ro(S.map[k].name)} 잘못 찾은` }));
    for (const c of forwardCands(S, progB, xb, { '㉠': h })) if (c.kind !== 'confuse') cands.push({ ...c, why: `(나)에서 ${c.why}` });
    const ds = pickDistractors(rng, cands, rb.out, dom, ['slot', 'omit', 'swap', 'slot', 'err']);
    if (ds.length < 4) continue;
    if (ds.filter((d) => d.kind === 'slot').length < 1) continue;
    const { vals, whys } = place(rng, rb.out, ds, ctx.target);
    const hits = vals.map((v, i) => (dom.same(v, rb.out) ? i + 1 : 0)).filter(Boolean);
    assert.deepEqual(hits, [ctx.target], '복합 변환: 정답 선지가 하나가 아님');
    ctx.usedInputs.add(dom.key(xa)); ctx.usedInputs.add(dom.key(xb));
    const sym = S.map[h];
    const other = S.map[ka[aFirst ? 1 : 0]];
    let ex = '<b>풀이</b> [1단계] (가)에서 ㉠ 찾기: ';
    if (dom.kind === 'str') {
      if (aFirst) ex += `출력 ${ra.out}에서 ${other.name}를 되돌리면(${other.invShort}) ${ra.trace[0].after}이다. 입력 ${xa}를 ${ra.trace[0].after}로 바꾸는 기호는 <b>${sym.name}</b>(${sym.short})뿐이다.`;
      else ex += `입력 ${xa}에 ${other.name}를 적용하면 ${ra.trace[0].after}이다. 이것을 출력 ${ra.out}으로 바꾸는 기호는 <b>${sym.name}</b>(${sym.short})뿐이다.`;
      ex += `<br>[2단계] (나)에 적용: ${traceText(S, xb, rb.trace)}. 따라서 정답은 ${rb.out}(${CIRC[ctx.target - 1]})이다.`;
      ex = ex.replace(/([가-힣]+)를 되돌리면/, (m, w) => `${J.eul(w)} 되돌리면`).replace(/([가-힣]+)를 적용하면/, (m, w) => `${J.eul(w)} 적용하면`)
        .replace(/입력 ([A-Z0-9]{4})를 ([A-Z0-9]{4})로/, (m, a, b) => `입력 ${J.eul(a)} ${J.ro(b)}`).replace(/출력 ([A-Z0-9]{4})으로/, (m, a) => `출력 ${J.ro(a)}`);
    } else {
      const mid = ra.trace[0].after;
      if (aFirst) ex += `(가)의 출력(${gridDesc(ra.out)})에서 ${J.eul(other.name)} 되돌리면(${other.invShort}) ${gridDesc(mid)}인 격자가 된다. 입력(${gridDesc(xa)})을 이렇게 바꾸는 기호는 <b>${sym.name}</b>(${sym.short})뿐이다.`;
      else ex += `(가)의 입력(${gridDesc(xa)})에 ${J.eul(other.name)} 적용하면(${other.short}) ${gridDesc(mid)}인 격자가 된다. 이것을 출력(${gridDesc(ra.out)})으로 바꾸는 기호는 <b>${sym.name}</b>(${sym.short})뿐이다.`;
      ex += `<br>[2단계] (나)에 적용: ${traceText(S, xb, rb.trace)}<br>따라서 정답은 ${CIRC[ctx.target - 1]}이다.`;
    }
    const noun = dom.kind === 'str' ? '결과' : '모양';
    ex += '<br><b>오답</b> ' + whys.map((w, i) => (w ? `${CIRC_EUN[i]} ${w} ${noun}이다.` : null)).filter(Boolean).join(' ');
    return {
      item: {
        subtype: '복합 변환',
        stem: `두 도식 (가), (나)의 ㉠은 같은 기호이다. (나)의 '?'에 들어갈 ${dom.noun}로 알맞은 것은?`,
        figure: { svg: twoRowSvg(S, [{ label: '(가)', prog: progA, inp: { v: xa }, out: { v: ra.out } }, { label: '(나)', prog: progB, inp: { v: xb }, out: { q: true } }]), caption: '' },
        ...choicesField(S, vals),
        answer: ctx.target,
        explanation: ex,
      },
      meta: { type: 'compound', progA, progB, xa, xb, outA: ra.out, out: rb.out, hidden: h, vals, nsym: symCount(progA) + symCount(progB) },
    };
  }
  throw new Error(`복합 변환 문항 생성 실패(set ${S.no})`);
}

/* ------------------------------------------------------------------ */
/* 회차 구성                                                            */
/* ------------------------------------------------------------------ */
// 회차별로 두 번씩 나오는 정답 번호(3회 합계가 번호별 5,5,5,5,4가 되도록)
const DOUBLES = { 1: [1, 2, 3], 2: [4, 5, 1], 3: [2, 3, 4] };

function addUsage(usage, ...progs) {
  for (const p of progs) for (const s of stepsOf(p)) if (s.key) usage[s.key] = (usage[s.key] || 0) + 1;
  for (const p of progs) for (const c of condsOf(p)) usage[c.key] = (usage[c.key] || 0) + 1;
}

function generateSet(S, seed) {
  const rng = new Rng(seed);
  const targets = rng.shuffle([1, 2, 3, 4, 5, ...DOUBLES[S.no]]);
  const ctx = { rng, S, usage: {}, usedInputs: new Set(), usedPairs: new Set(), target: 0 };
  const lin = (n) => () => P(chooseKeys(rng, S, n, ctx.usage));
  const results = [];
  const push = (r, hiddenKeys = []) => {
    results.push(r);
    const m = r.meta;
    addUsage(ctx.usage, ...(m.prog ? [m.prog] : [m.progA, m.progB]));
    for (const k of hiddenKeys) ctx.usage[k] = (ctx.usage[k] || 0) + 1;
  };
  const at = (i) => { ctx.target = targets[i]; return ctx; };

  if (S.no === 1 || S.no === 2) {
    push(buildForward(at(0), { makeProg: lin(2) }));
    push(buildForward(at(1), { makeProg: lin(3) }));
    push(buildForward(at(2), { makeProg: lin(3) }));
    push(buildForward(at(3), { makeProg: lin(4) }));
    let r = buildMissing(at(4), { n: 3 }); push(r, [r.meta.hidden]);
    r = buildMissing(at(5), { n: 4 }); push(r, [r.meta.hidden]);
    push(buildReverse(at(6), { makeProg: lin(3) }));
    r = buildCompound(at(7)); push(r, [r.meta.hidden, r.meta.hidden]);
  } else {
    const [E, F] = S.ckeys;
    const ck = () => rng.pick(S.ckeys);
    const k1 = (n) => chooseKeys(rng, S, n, ctx.usage);
    const branch = (pre, yes, no, key) => () => {
      const ks = k1(pre + yes + no);
      return P(ks.slice(0, pre), Cn(key ? key() : ck(), P(ks.slice(pre, pre + yes)), P(ks.slice(pre + yes))));
    };
    const pathIs = (want) => (res) => res.trace.filter((t) => t.t === 'C').map((t) => (t.res ? 'Y' : 'N')).join('') === want;
    const withTrap = (want) => {
      const f = (res, prog, x) => pathIs(want)(res) && !STR.same(run(S, prog, x, { condOnOrig: true }).out, res.out);
      return f;
    };
    push(buildForward(at(0), { makeProg: lin(2) }));
    push(buildForward(at(1), { makeProg: lin(3) }));
    push(buildForward(at(2), { makeProg: branch(1, 1, 1, () => E), require: withTrap('Y'), kindOrder: ['orig', 'flip', 'omit', 'err', 'swap', 'confuse'] }));
    push(buildForward(at(3), { makeProg: branch(2, 1, 1, () => F), require: withTrap('N'), kindOrder: ['orig', 'flip', 'omit', 'err', 'swap', 'confuse'] }));
    let r = buildMissingPair(at(4), { makeProg: () => { const k = k1(1)[0]; return P(['가', k, '나']); } });
    push(r, r.meta.pair);
    r = buildMissingPair(at(5), {
      makeProg: () => { const ks = k1(2); return P(['가'], Cn(ck(), P(['나', ks[0]]), P([ks[1]]))); },
      require: pathIs('Y'),
    });
    push(r, r.meta.pair);
    push(buildReverse(at(6), { makeProg: branch(1, 1, 1), require: () => true }));
    // 조건 분기: 마름모 두 개(첫 마름모 No → 둘째 마름모), 조건 판정 시점을 묻는 함정 포함
    push(buildForward(at(7), {
      subtype: '조건 분기',
      makeProg: () => {
        const ks = k1(4); const first = rng.int(2) ? E : F; const second = first === E ? F : E;
        return P([ks[0]], Cn(first, P([ks[1]]), P([], Cn(second, P([ks[2]]), P([ks[3]])))));
      },
      require: (res, prog, x) => /^N[YN]$/.test(res.trace.filter((t) => t.t === 'C').map((t) => (t.res ? 'Y' : 'N')).join('')) && !STR.same(run(S, prog, x, { condOnOrig: true }).out, res.out),
      kindOrder: ['orig', 'flip', 'omit', 'err', 'swap', 'confuse'],
    }));
  }
  results.forEach((r, i) => { r.item = { id: `S${S.no}-DI-${String(i + 1).padStart(2, '0')}`, ...r.item }; });

  // 회차 단위 검사: 변환 기호마다 2번 이상, 조건 기호마다 2번 이상 등장
  for (const k of [...S.tkeys, ...S.ckeys]) {
    if ((ctx.usage[k] || 0) < 2) throw new Error(`기호 ${k} 사용 횟수 부족(${ctx.usage[k] || 0})`);
  }
  return { results, usage: ctx.usage, targets };
}

function buildRules(S) {
  const exampleGrid = [2, 1, 1, 0, 0, 0, 1, 0, 3];
  return {
    title: S.title,
    intro: S.intro,
    symbols: S.symbols.map((s) => {
      const o = { key: s.key, svg: iconSvg(s), name: s.name, desc: s.desc, example: s.example };
      if (S.dom.kind === 'grid') o.exampleSvg = exampleGridSvg(s, exampleGrid);
      return o;
    }),
    note: S.note,
  };
}

/* ------------------------------------------------------------------ */
/* 최종 검증                                                            */
/* ------------------------------------------------------------------ */
function checkSvg(svg, where) {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"[^>]*>/, `${where}: svg 머리`);
  const root = svg.slice(0, svg.indexOf('>') + 1);
  assert.ok(!/\swidth=|\sheight=/.test(root), `${where}: 루트에 width/height 금지`);
  assert.ok(/<rect x="0" y="0" width="\d+" height="\d+" fill="#ffffff"\/>/.test(svg), `${where}: 흰 배경 rect 필요`);
  assert.ok(!/\sid=/.test(svg), `${where}: id 속성 금지(인라인 충돌 방지)`);
  assert.ok(svg.endsWith('</svg>'), `${where}: 닫는 태그`);
}
function validatePayload(S, payload, gen) {
  const { rules, items } = payload;
  assert.equal(rules.title, '도식 규칙');
  assert.ok(rules.intro && rules.note);
  assert.ok(rules.symbols.length >= 5 && rules.symbols.length <= 6);
  rules.symbols.forEach((s) => { checkSvg(s.svg, `rules ${s.key}`); if (s.exampleSvg) checkSvg(s.exampleSvg, `rules ex ${s.key}`); assert.ok(s.name && s.desc && s.example); });
  assert.equal(items.length, 8);
  const want = ['순방향 변환', '순방향 변환', '순방향 변환', '순방향 변환', '빠진 기호 추론', '빠진 기호 추론', '역방향 추론', S.no === 3 ? '조건 분기' : '복합 변환'];
  assert.deepEqual(items.map((it) => it.subtype), want);
  items.forEach((it, i) => {
    assert.equal(it.id, `S${S.no}-DI-${String(i + 1).padStart(2, '0')}`);
    assert.ok(it.stem && it.explanation && it.explanation.length > 40, `${it.id}: 발문/해설`);
    assert.ok(Number.isInteger(it.answer) && it.answer >= 1 && it.answer <= 5);
    checkSvg(it.figure.svg, `${it.id} figure`);
    const n = (it.choices || it.choiceSvgs).length;
    assert.equal(n, 5, `${it.id}: 선지 5개`);
    assert.ok(!(it.choices && it.choiceSvgs), `${it.id}: choices와 choiceSvgs 동시 사용 금지`);
    (it.choiceSvgs || []).forEach((s, j) => checkSvg(s, `${it.id} choice ${j + 1}`));
    if (it.choices) assert.equal(new Set(it.choices).size, 5, `${it.id}: 선지 중복`);
    if (it.choiceSvgs) assert.equal(new Set(it.choiceSvgs).size, 5, `${it.id}: 그림 선지 중복`);
    if (it.choices) it.choices.forEach((c) => assert.ok(!/[IO]/.test(c), `${it.id}: I/O 금지`));
    assert.ok(!/undefined|NaN|\[object/.test(JSON.stringify(it)), `${it.id}: 잘못된 값`);
    // 설명 태그는 허용된 인라인 태그만
    const tags = it.explanation.match(/<\/?([a-z]+)/g) || [];
    tags.forEach((t) => assert.ok(/^<\/?(b|u|br|sup|sub)$/.test(t), `${it.id}: 허용되지 않은 태그 ${t}`));
  });
  // 정답 번호 분포: 2,2,2,1,1
  const cnt = [0, 0, 0, 0, 0]; items.forEach((it) => cnt[it.answer - 1]++);
  assert.deepEqual(cnt.slice().sort((a, b) => b - a), [2, 2, 2, 1, 1], `정답 분포 ${cnt}`);
  // 기호 개수: 앞 4문항(순방향)은 2개 → 4개로 늘어난다.
  const ns = gen.results.slice(0, 4).map((r) => r.meta.npath);
  for (let i = 1; i < ns.length; i++) assert.ok(ns[i] >= ns[i - 1], `난이도(기호 수) 순서 ${ns}`);
  assert.deepEqual([ns[0], ns[3]], [2, 4], `순방향 기호 수는 2개에서 4개로 ${ns}`);
  // 의미 검증을 독립적으로 한 번 더(생성 단계와 별도로 다시 계산)
  return gen.results.map((r, i) => {
    const it = items[i], m = r.meta, dom = S.dom;
    let detail;
    if (m.type === 'forward') {
      const out = run(S, m.prog, m.x).out;
      const hits = m.vals.filter((v) => dom.same(v, out)).length;
      assert.equal(hits, 1); assert.ok(dom.same(m.vals[it.answer - 1], out));
      detail = `선지 중 계산값과 일치 ${hits}개`;
    } else if (m.type === 'missing') {
      const hits = S.tkeys.filter((k) => dom.same(run(S, m.prog, m.x, { assign: { '?': k } }).out, m.out));
      assert.deepEqual(hits, [S.tkeys[it.answer - 1]]);
      detail = `기호 ${S.tkeys.length}개 대입 시 출력 일치 ${hits.length}개`;
    } else if (m.type === 'pair') {
      let hits = 0;
      for (const a of S.tkeys) for (const b of S.tkeys) if (run(S, m.prog, m.x, { assign: { 가: a, 나: b } }).out === m.out) hits++;
      assert.equal(hits, 1);
      const ch = m.vals.filter(([a, b]) => run(S, m.prog, m.x, { assign: { 가: a, 나: b } }).out === m.out).length;
      assert.equal(ch, 1);
      detail = `16개 조합 중 일치 ${hits}개, 선지 중 ${ch}개`;
    } else if (m.type === 'reverse') {
      const hits = m.vals.filter((v) => dom.same(run(S, m.prog, v).out, m.out)).length;
      assert.equal(hits, 1); assert.ok(dom.same(run(S, m.prog, m.vals[it.answer - 1]).out, m.out));
      detail = `선지 순방향 계산 시 출력 일치 ${hits}개`;
    } else if (m.type === 'compound') {
      const hk = S.tkeys.filter((k) => dom.same(run(S, m.progA, m.xa, { assign: { '㉠': k } }).out, m.outA));
      assert.deepEqual(hk, [m.hidden]);
      const out = run(S, m.progB, m.xb, { assign: { '㉠': m.hidden } }).out;
      const hits = m.vals.filter((v) => dom.same(v, out)).length;
      assert.equal(hits, 1); assert.ok(dom.same(m.vals[it.answer - 1], out));
      detail = `㉠ 후보 일치 ${hk.length}개, 선지 일치 ${hits}개`;
    }
    const sym = m.npath && m.npath !== m.nsym ? `기호 ${m.nsym}개(지나는 기호 ${m.npath}개)` : `기호 ${m.nsym}개`;
    return `  ${it.id} ${it.subtype.padEnd(8, ' ')} 정답 ${CIRC[it.answer - 1]}  ${sym.padEnd(18, ' ')}${m.path ? ` 갈래 ${m.path.split('').map((c) => (c === 'Y' ? 'Yes' : 'No')).join('→')}` : ''}  ✔ ${detail}`;
  });
}

/* ------------------------------------------------------------------ */
/* 실행                                                                 */
/* ------------------------------------------------------------------ */
function main() {
  const sets = [SET1, SET2, SET3];
  const total = [0, 0, 0, 0, 0];
  console.log('도식이해 생성기 — 검증 요약');
  for (const S of sets) {
    let seed = BASE_SEED[S.no], gen = null, tries = 0;
    for (; tries < MAX_SET_RETRIES; tries++, seed += 7919) {
      try { gen = generateSet(S, seed); break; } catch (e) {
        if (e instanceof assert.AssertionError) throw e; // 검증 로직 위반은 즉시 중단
        if (process.env.DEBUG) console.warn(`  [set ${S.no}] seed ${seed} 재시도: ${e.message}`);
      }
    }
    if (!gen) throw new Error(`set ${S.no}: ${MAX_SET_RETRIES}번 시도했지만 생성 실패`);
    const payload = { rules: buildRules(S), items: gen.results.map((r) => r.item) };
    const lines = validatePayload(S, payload, gen);
    const file = path.join(ROOT, 'data', `set${S.no}-diagram.js`);
    const header = `/* 자동 생성 파일 — node tools/gen-diagram.mjs (seed ${seed}). 직접 고치지 말고 생성기를 고쳐 다시 실행할 것. */`;
    fs.writeFileSync(file, `${header}\nHMAT.add(${S.no}, 'diagram', ${JSON.stringify(payload, null, 1)});\n`);
    const cnt = [0, 0, 0, 0, 0]; payload.items.forEach((it) => { cnt[it.answer - 1]++; total[it.answer - 1]++; });
    console.log(`\n[${S.no}회] ${path.relative(ROOT, file)}  seed=${seed}${tries ? ` (재시도 ${tries}회)` : ''}  기호 ${S.symbols.length}개`);
    lines.forEach((l) => console.log(l));
    console.log(`  정답 분포 ①~⑤: ${cnt.join(', ')}  기호 사용 횟수: ${Object.entries(gen.usage).sort().map(([k, v]) => `${S.map[k].name} ${v}`).join(', ')}`);
  }
  console.log(`\n3회 합계 정답 분포 ①~⑤: ${total.join(', ')}`);
  console.log('모든 검증 통과.');
}
main();
