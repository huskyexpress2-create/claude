#!/usr/bin/env node
/**
 * tools/gen-spatial.mjs : 공간지각(spatial) 문항 생성기
 *
 *   node tools/gen-spatial.mjs
 *
 * data/set{1,2,3}-spatial.js 를 만든다. 형식은 docs/SCHEMA.md 를 따른다.
 * - 외부 의존성 없음(Node 22 ESM). 시드를 고정한 mulberry32 PRNG를 써서 다시 돌려도 같은 결과가 나온다.
 * - 문항마다 정답이 하나뿐인지 코드로 검증한다. 검증에 실패하면 다음 시도 시드로 다시 만들고,
 *   시도를 다 써도 실패하면 예외를 던진다.
 *
 * 좌표 규칙(블록 입체)
 *   높이맵 h[y][x] : x = 왼쪽→오른쪽, y = 앞(0)→뒤, 값 = 바닥부터 쌓인 블록 수(공중부양 없음)
 *   등각투상 시점 : 오른쪽-앞-위에서 내려다봄. 보이는 면은 윗면(+z), 정면(-y, 화면 왼쪽 아래), 우측면(+x, 화면 오른쪽 아래)
 *   정면도  : 앞에서 본 모양. 가로 = x(왼→오), 세로 = 높이
 *   우측면도 : 오른쪽에서 본 모양. 가로 = y(앞→뒤, 즉 그림의 왼쪽이 앞), 세로 = 높이
 *   평면도  : 위에서 본 모양. 가로 = x, 세로 = y(그림 아래쪽이 앞)
 *   제3각법 배치 : 평면도는 정면도 위, 우측면도는 정면도 오른쪽
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data');
const SEEDS = { 1: 0x51a7_0001, 2: 0x51a7_0002, 3: 0x51a7_0003 };

const FONT = "Pretendard, 'Noto Sans KR', sans-serif";
const INK = '#222';
const SHADE = ['#ffffff', '#d9d9d9', '#a8a8a8']; // 윗면 / 정면(왼쪽 아래) / 우측면(오른쪽 아래)
const C30 = Math.sqrt(3) / 2;
const CIRC = ['①', '②', '③', '④', '⑤'];

// ───────────────────────────── 공용 유틸 ─────────────────────────────
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
function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x7c; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
class Rng {
  constructor(seed) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  int(n) { return Math.floor(this.f() * n); }
  range(a, b) { return a + this.int(b - a + 1); }
  pick(arr) { return arr[this.int(arr.length)]; }
  chance(p) { return this.f() < p; }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}
class GenError extends Error {}
function check(cond, msg) { if (!cond) throw new GenError(msg); }
function assert(cond, msg) { if (!cond) throw new Error('검증 실패: ' + msg); }

const fmt = (n) => { const r = Math.round(n * 10) / 10; return Object.is(r, -0) ? '0' : String(r); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function svgDoc(w, h, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" role="img" aria-label="${esc(label)}">`
    + `<rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" fill="#fff"/>${body}</svg>`;
}
function svgText(x, y, str, { size = 13, anchor = 'middle', weight = 'normal', fill = INK } = {}) {
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(str)}</text>`;
}
function arrowHead(tip, from, size = 7, fill = INK) {
  const dx = tip[0] - from[0], dy = tip[1] - from[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const bx = tip[0] - ux * size, by = tip[1] - uy * size;
  const w = size * 0.55;
  const p1 = [bx - uy * w, by + ux * w], p2 = [bx + uy * w, by - ux * w];
  return `<polygon points="${fmt(tip[0])},${fmt(tip[1])} ${fmt(p1[0])},${fmt(p1[1])} ${fmt(p2[0])},${fmt(p2[1])}" fill="${fill}" stroke="none"/>`;
}

// 한국어 조사
const JONG_LETTERS = new Set(['L', 'M', 'N', 'R']);
function hasJong(word) {
  const w = String(word);
  const ch = w[w.length - 1];
  if (CIRC.includes(ch)) return ch === '①' || ch === '③';
  if (/[A-Z]/.test(ch)) return JONG_LETTERS.has(ch);
  if (/[0-9]/.test(ch)) return '0136780'.includes(ch);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) return code % 28 !== 0;
  return false;
}
function j(word, pair) { const [a, b] = pair.split('/'); return word + (hasJong(word) ? a : b); }

// ───────────────────────────── 높이맵 ─────────────────────────────
const hmClone = (h) => h.map((r) => r.slice());
const hmKey = (h) => h.map((r) => r.join('')).join('/');
const hmCount = (h) => h.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
const hmMax = (h) => Math.max(...h.map((r) => Math.max(...r)));
function hmCrop(h) {
  let y0 = 0, y1 = h.length - 1, x0 = 0, x1 = h[0].length - 1;
  const rowEmpty = (y) => h[y].every((v) => v === 0);
  const colEmpty = (x) => h.every((r) => r[x] === 0);
  while (y0 <= y1 && rowEmpty(y0)) y0++;
  while (y1 >= y0 && rowEmpty(y1)) y1--;
  while (x0 <= x1 && colEmpty(x0)) x0++;
  while (x1 >= x0 && colEmpty(x1)) x1--;
  if (y0 > y1) return [[0]];
  return h.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1));
}
function hmConnected(h) {
  const Y = h.length, X = h[0].length;
  const cells = [];
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) if (h[y][x] > 0) cells.push([x, y]);
  if (!cells.length) return false;
  const seen = new Set([cells[0].join()]);
  const st = [cells[0]];
  while (st.length) {
    const [x, y] = st.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= X || ny >= Y || h[ny][nx] === 0) continue;
      const k = nx + ',' + ny;
      if (!seen.has(k)) { seen.add(k); st.push([nx, ny]); }
    }
  }
  return seen.size === cells.length;
}
function hmViews(h) {
  const Y = h.length, X = h[0].length;
  const front = [], right = [];
  for (let x = 0; x < X; x++) front.push(Math.max(...h.map((r) => r[x])));
  for (let y = 0; y < Y; y++) right.push(Math.max(...h[y]));
  return { front, right, top: h.map((r) => r.map((v) => (v > 0 ? 1 : 0))) };
}
const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const topEq = (a, b) => a.length === b.length && a.every((r, i) => arrEq(r, b[i]));
function viewMismatch(V, W) {
  return { F: !arrEq(V.front, W.front), R: !arrEq(V.right, W.right), T: !topEq(V.top, W.top) };
}
const mmKey = (m) => (m.F ? 'F' : '') + (m.R ? 'R' : '') + (m.T ? 'T' : '');

// 격자 비트맵(투상도) : rows[0]이 그림의 맨 위
function skyBitmap(arr) {
  const H = Math.max(...arr);
  const rows = [];
  for (let r = 0; r < H; r++) { const z = H - 1 - r; rows.push(arr.map((v) => (v > z ? '1' : '0')).join('')); }
  return { w: arr.length, h: H, rows };
}
function topBitmapOf(top) { // top[y][x], y=0 앞 → 그림 아래
  const Y = top.length;
  const rows = [];
  for (let r = 0; r < Y; r++) rows.push(top[Y - 1 - r].map((v) => (v ? '1' : '0')).join(''));
  return { w: top[0].length, h: Y, rows };
}
const bmKey = (b) => `${b.w}x${b.h}:${b.rows.join('/')}`;

// ─────────────── 등각투상 : 삼각 격자 서명(가시성·유일성 검사용) ───────────────
// 화면 좌표 a = x+y (가로), b = x-y-2z (세로, 아래로 +). 단위 정육면체의 면은 격자 삼각형 2개로 정확히 덮인다.
const TK = (t, a, b) => (t * 512 + (a + 128)) * 1024 + (b + 512);
const FK = (o, a, b) => (o * 512 + (a + 128)) * 1024 + (b + 512) + 1e9;
function renderTris(h) {
  const Y = h.length, X = h[0].length;
  const H = (x, y) => (x >= 0 && x < X && y >= 0 && y < Y ? h[y][x] : 0);
  const cubes = [];
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) for (let z = 0; z < h[y][x]; z++) cubes.push([x, y, z]);
  cubes.sort((p, q) => (p[0] - p[1] + p[2]) - (q[0] - q[1] + q[2]) || p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
  const faces = [], owner = new Map(), sig = new Map(), topFace = new Map();
  const add = (o, x, y, z, fk, tris) => {
    const idx = faces.length;
    faces.push({ o, x, y, z, fk });
    for (const t of tris) { owner.set(t, idx); sig.set(t, fk); }
    return idx;
  };
  for (const [x, y, z] of cubes) {
    const a = x + y;
    if (H(x, y) === z + 1) {
      const b0 = x - y - 2 * z - 2;
      topFace.set(x + ',' + y, add(0, x, y, z, FK(0, a, b0), [TK(0, a, b0), TK(1, a + 1, b0)]));
    }
    if (H(x, y - 1) <= z) {
      const b1 = x - y - 2 * z;
      add(1, x, y, z, FK(1, a, b1), [TK(1, a, b1 - 1), TK(0, a, b1)]);
    }
    if (H(x + 1, y) <= z) {
      const a1 = a + 1, b2 = x + 1 - y - 2 * z;
      add(2, x, y, z, FK(2, a1, b2), [TK(0, a1, b2 - 2), TK(1, a1, b2 - 1)]);
    }
  }
  return { faces, owner, sig, topFace };
}
function sameSig(m1, m2) {
  if (m1.size !== m2.size) return false;
  for (const [k, v] of m1) if (m2.get(k) !== v) return false;
  return true;
}
/**
 * 그림만 보고 높이맵이 유일하게 결정되는지 검사한다.
 *  (1) 블록이 있는 모든 열의 윗면이 적어도 절반(격자 삼각형 1개 이상) 보일 것
 *      블록이 없는 칸은 바닥판이 적어도 절반 보일 것
 *  (2) 어느 한 칸의 높이를 0~(최대+1) 사이 다른 값으로 바꾸면 그림이 반드시 달라질 것
 *  (3) 화면에서 겹칠 수 있는 두 칸(|Δ(x+y)|≤1)을 동시에 바꿔도 그림이 반드시 달라질 것
 * 읽기 쉬움 조건(선택) : 수험생이 그림에서 높이를 직접 읽어야 하는 문항에 쓴다.
 *  fullTops       : 모든 열의 윗면이 온전히(격자 삼각형 2개) 보일 것
 *  critical       : 'front' | 'right'. 정답을 정하는 기둥(정면도라면 열마다, 우측면도라면 줄마다 가장 높은 기둥)의
 *                   윗면은 온전히 보일 것
 *  maxPartialTops : 일부가 가려진 윗면의 최대 개수
 *  fullFloor      : 빈칸의 바닥판이 온전히 보일 것(반쯤 가려진 빈칸은 블록이 있는 칸으로 잘못 읽기 쉽다)
 */
function checkVisibility(h, { fullTops = false, critical = null, maxPartialTops = Infinity, fullFloor = false } = {}) {
  const Y = h.length, X = h[0].length;
  const base = renderTris(h);
  const ownCount = new Map();
  for (const idx of base.owner.values()) ownCount.set(idx, (ownCount.get(idx) || 0) + 1);
  const crit = new Set();
  if (critical === 'front') for (let x = 0; x < X; x++) { const m = Math.max(...h.map((r) => r[x])); for (let y = 0; y < Y; y++) if (m > 0 && h[y][x] === m) crit.add(x + ',' + y); }
  if (critical === 'right') for (let y = 0; y < Y; y++) { const m = Math.max(...h[y]); for (let x = 0; x < X; x++) if (m > 0 && h[y][x] === m) crit.add(x + ',' + y); }
  let partial = 0;
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    if (h[y][x] === 0) continue;
    const n = ownCount.get(base.topFace.get(x + ',' + y)) || 0;
    if (!n || (n < 2 && (fullTops || crit.has(x + ',' + y)))) return { ok: false, reason: `윗면 가림 (${x},${y})` };
    if (n < 2) partial++;
  }
  if (partial > maxPartialTops) return { ok: false, reason: `일부가 가려진 윗면 ${partial}개` };
  // 빈칸은 바닥판이 적어도 절반은 보여야 한다(구덩이 바닥이 안 보이면 블록이 숨어 있는지 알 수 없다)
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    if (h[y][x] !== 0) continue;
    const a = x + y, b = x - y;
    const hidden = (base.owner.has(TK(0, a, b)) ? 1 : 0) + (base.owner.has(TK(1, a + 1, b)) ? 1 : 0);
    if (hidden === 2 || (fullFloor && hidden > 0)) return { ok: false, reason: `빈칸 바닥 가림 (${x},${y})` };
  }
  const maxAlt = hmMax(h) + 1;
  const g = hmClone(h);
  let tested = 0;
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    for (let v = 0; v <= maxAlt; v++) {
      if (v === h[y][x]) continue;
      g[y][x] = v; tested++;
      const same = sameSig(renderTris(g).sig, base.sig);
      g[y][x] = h[y][x];
      if (same) return { ok: false, reason: `칸 (${x},${y}) 높이 ${v}와 구별 불가` };
    }
  }
  const cells = [];
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) cells.push([x, y]);
  for (let i = 0; i < cells.length; i++) for (let k = i + 1; k < cells.length; k++) {
    const [x1, y1] = cells[i], [x2, y2] = cells[k];
    if (Math.abs(x1 + y1 - x2 - y2) > 1) continue;
    for (let v1 = 0; v1 <= maxAlt; v1++) {
      if (v1 === h[y1][x1]) continue;
      for (let v2 = 0; v2 <= maxAlt; v2++) {
        if (v2 === h[y2][x2]) continue;
        g[y1][x1] = v1; g[y2][x2] = v2; tested++;
        const same = sameSig(renderTris(g).sig, base.sig);
        g[y1][x1] = h[y1][x1]; g[y2][x2] = h[y2][x2];
        if (same) return { ok: false, reason: `두 칸 동시 변경과 구별 불가` };
      }
    }
  }
  return { ok: true, tested };
}

// 등각투상에서는 (x+1, y-1, z)와 (x, y, z-1)이 화면의 같은 자리에 그려진다. 그래서 시선 방향(앞-오른쪽 ↔ 뒤-왼쪽)으로
// 가늘게 늘어선 구조는 탑처럼 쌓인 것으로 잘못 읽히기 쉽다. 화면의 왼쪽 끝(앞-왼쪽 모서리)과 오른쪽 끝(뒤-오른쪽 모서리)
// 칸을 채우고, 바닥 칸의 60% 이상을 채운 구조만 쓴다.
function hmReadable(h) {
  const Y = h.length, X = h[0].length;
  if (h[0][0] === 0 || h[Y - 1][X - 1] === 0) return false;
  const filled = h.flat().filter((v) => v > 0).length;
  return filled >= 0.6 * X * Y;
}
function hmValid(h, X, Y, maxH, needHole) {
  if (!hmReadable(h)) return false;
  if (h.length !== Y || h[0].length !== X) return false;
  const c = hmCrop(h);
  if (c.length !== Y || c[0].length !== X) return false;
  if (hmMax(h) !== maxH) return false;
  if (!hmConnected(h)) return false;
  if (needHole && !h.some((r) => r.some((v) => v === 0))) return false;
  return true;
}
function genHeightmap(rng, { X, Y, maxH, minCount, maxCount, zeroP = 0.14, needHole = false, minLevels = 2, maxHoles = Infinity, read = {} }) {
  for (let t = 0; t < 40000; t++) {
    const h = [];
    for (let y = 0; y < Y; y++) {
      const row = [];
      for (let x = 0; x < X; x++) {
        const tb = 0.5 * (y / (Y - 1)) + 0.5 * (1 - x / (X - 1)); // 뒤·왼쪽일수록 1
        let v = Math.round(1 + tb * (maxH - 1) + (rng.next() - 0.5) * 2.6);
        if (rng.chance(zeroP)) v = 0;
        row.push(Math.max(0, Math.min(maxH, v)));
      }
      h.push(row);
    }
    if (!hmValid(h, X, Y, maxH, needHole)) continue;
    const n = hmCount(h);
    if (n < minCount || n > maxCount) continue;
    const levels = new Set(h.flat().filter((v) => v > 0));
    if (levels.size < minLevels) continue;
    if (h.flat().filter((v) => v === 0).length > maxHoles) continue;
    if (!checkVisibility(h, read).ok) continue;
    return h;
  }
  throw new GenError('높이맵 생성 실패');
}

// ───────────────────────────── 등각투상 SVG ─────────────────────────────
function isoParts(h, s, { arrow = false } = {}) {
  const R = renderTris(h);
  const vis = new Set(R.owner.values());
  const X = h[0].length;
  const P = (x, y, z) => [(x + y) * C30 * s, ((x - y) / 2 - z) * s];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = ([px, py]) => { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); };
  const polys = [];
  // 바닥판 : 블록이 없는 칸의 바닥을 연한 회색으로 깔아, 뒤쪽에 있는 블록이 공중에 뜬 것처럼 보이지 않게 한다.
  const Y = h.length;
  const floor = [];
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    const q = [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]].map((p) => P(...p));
    q.forEach(grow);
    if (h[y][x] === 0) floor.push(`<polygon points="${q.map(([a, b]) => fmt(a) + ',' + fmt(b)).join(' ')}"/>`);
  }
  const plate = [[0, 0, 0], [X, 0, 0], [X, Y, 0], [0, Y, 0]].map((p) => P(...p));
  const floorSvg = `<polygon points="${plate.map(([a, b]) => fmt(a) + ',' + fmt(b)).join(' ')}" fill="#efefef" stroke="#9e9e9e" stroke-width="1.2"/>`
    + (floor.length ? `<g fill="#efefef" stroke="#b9b9b9" stroke-width="1">${floor.join('')}</g>` : '');
  R.faces.forEach((f, i) => {
    if (!vis.has(i)) return;
    const { o, x, y, z } = f;
    const pts = o === 0 ? [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]]
      : o === 1 ? [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]]
        : [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]];
    const q = pts.map((p) => P(...p));
    q.forEach(grow);
    polys.push(`<polygon points="${q.map(([a, b]) => fmt(a) + ',' + fmt(b)).join(' ')}" fill="${SHADE[o]}"/>`);
  });
  let extra = '';
  if (arrow) {
    const t = P(X / 2 - 0.2, -1.65, 0), e = P(X / 2 - 0.2, -0.4, 0);
    grow([t[0] - 22, t[1] + 16]); grow(e);
    extra += `<line x1="${fmt(t[0])}" y1="${fmt(t[1])}" x2="${fmt(e[0])}" y2="${fmt(e[1])}" stroke="${INK}" stroke-width="1.6"/>`;
    extra += arrowHead(e, t, 8);
    extra += svgText(t[0] - 2, t[1] + 14, '정면', { size: 12, anchor: 'end' });
  }
  return { minX, minY, maxX, maxY, body: `${floorSvg}<g stroke="${INK}" stroke-width="1.6" stroke-linejoin="round">${polys.join('')}</g>${extra}` };
}
function isoSVGs(hs, s, opts, labels) {
  const parts = hs.map((h) => isoParts(h, s, opts));
  const pad = 10;
  const W = Math.max(...parts.map((p) => p.maxX - p.minX)) + 2 * pad;
  const H = Math.max(...parts.map((p) => p.maxY - p.minY)) + 2 * pad;
  return parts.map((p, i) => {
    const dx = (W - (p.maxX - p.minX)) / 2 - p.minX, dy = (H - (p.maxY - p.minY)) / 2 - p.minY;
    return svgDoc(W, H, `<g transform="translate(${fmt(dx)} ${fmt(dy)})">${p.body}</g>`, labels[i]);
  });
}

// ───────────────────────────── 투상도 SVG ─────────────────────────────
function bitmapBody(bm, ox, oy, s) {
  const d = [];
  for (let i = 0; i <= bm.w; i++) d.push(`M${fmt(ox + i * s)} ${fmt(oy)}V${fmt(oy + bm.h * s)}`);
  for (let k = 0; k <= bm.h; k++) d.push(`M${fmt(ox)} ${fmt(oy + k * s)}H${fmt(ox + bm.w * s)}`);
  let out = `<path d="${d.join('')}" fill="none" stroke="#b5b5b5" stroke-width="1" stroke-dasharray="3 2"/>`;
  const rects = [];
  for (let r = 0; r < bm.h; r++) for (let c = 0; c < bm.w; c++) {
    if (bm.rows[r][c] === '1') rects.push(`<rect x="${fmt(ox + c * s)}" y="${fmt(oy + r * s)}" width="${fmt(s)}" height="${fmt(s)}"/>`);
  }
  out += `<g fill="#d9d9d9" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round">${rects.join('')}</g>`;
  return out;
}
function threeViewSVG(h) {
  const s = 24, pad = 12, gapV = 30, gapH = 34, labelGap = 18;
  const V = hmViews(h);
  const fb = skyBitmap(V.front), rb = skyBitmap(V.right), tb = topBitmapOf(V.top);
  const topX = pad, topY = pad;
  const frontX = pad, frontY = topY + tb.h * s + gapV;
  const rightX = frontX + fb.w * s + gapH, rightY = frontY + (fb.h - rb.h) * s;
  const W = rightX + rb.w * s + pad;
  const H = frontY + fb.h * s + labelGap + 10 + pad;
  let body = '';
  body += bitmapBody(tb, topX, topY, s);
  body += bitmapBody(fb, frontX, frontY, s);
  body += bitmapBody(rb, rightX, rightY, s);
  body += svgText(topX + tb.w * s + 12, topY + tb.h * s / 2 + 5, '평면도', { size: 14, anchor: 'start', weight: 'bold' });
  body += svgText(frontX + fb.w * s / 2, frontY + fb.h * s + labelGap + 2, '정면도', { size: 14, weight: 'bold' });
  body += svgText(rightX + rb.w * s / 2, frontY + fb.h * s + labelGap + 2, '우측면도', { size: 14, weight: 'bold' });
  return svgDoc(W, H, body, '평면도, 정면도, 우측면도');
}
// frontMark : 평면도 선지에 쓴다. 격자 아래에 위쪽을 가리키는 화살표와 '정면'을 그려, 평면도의 아래쪽이 정면(앞줄)임을
// 글자와 모양으로 함께 보여 준다(입체 그림의 '정면' 화살표와 같은 방향 약속).
const FRONT_MARK_H = 30;
function frontMarkBody(cx, y0) {
  const tip = [cx, y0 + 4], tail = [cx, y0 + 18];
  return `<line x1="${fmt(tail[0])}" y1="${fmt(tail[1])}" x2="${fmt(tip[0])}" y2="${fmt(tip[1] + 5)}" stroke="${INK}" stroke-width="1.6"/>`
    + arrowHead(tip, tail, 7)
    + svgText(cx + 7, y0 + 18, '정면', { size: 12, anchor: 'start' });
}
function bitmapChoiceSVGs(bms, labels, { bottomAlign = true, frontMark = false } = {}) {
  const s = 24, pad = 12;
  const mw = Math.max(...bms.map((b) => b.w)), mh = Math.max(...bms.map((b) => b.h));
  const W = mw * s + 2 * pad, H = mh * s + 2 * pad + (frontMark ? FRONT_MARK_H - 4 : 0);
  return bms.map((b, i) => {
    const ox = pad + (mw - b.w) * s / 2;
    const oy = bottomAlign ? pad + (mh - b.h) * s : pad + (mh - b.h) * s / 2;
    const mark = frontMark ? frontMarkBody(W / 2 - 13, pad + mh * s) : ''; // 화살표+글자 묶음이 가운데 오게
    return svgDoc(W, H, bitmapBody(b, ox, oy, s) + mark, labels[i]);
  });
}

// ───────────────────────────── 정답 위치 ─────────────────────────────
function placeChoices(correct, distractors, ansPos) {
  // ansPos: 1~5. distractors 4개를 나머지 자리에 순서대로 넣는다.
  const out = [];
  let k = 0;
  const meta = [];
  for (let i = 1; i <= 5; i++) {
    if (i === ansPos) { out.push(correct); meta.push(null); } else { out.push(distractors[k].v); meta.push(distractors[k]); k++; }
  }
  return { list: out, meta };
}

// ─────────────── 찍기 단서 점검 : 선지 집합의 중심(medoid)과 자리별 다수결 ───────────────
// 오답 4개가 모두 정답에서 한 곳만 바꾼 변형이면, 그림을 풀지 않고도 '다른 선지와 가장 덜 다른 것(중심)'이나
// '자리마다 가장 많은 선지가 가진 값을 모은 조합(다수결)'을 고르면 정답이 나온다. 그래서 오답은 정답에서 한 곳을 바꾼
// 미끼(decoy)를 하나 만들고 다른 오답 일부는 그 미끼에서 다시 한 곳을 바꿔 만들거나(미끼가 중심이 된다), 투상도로는 정답과
// 구별되지 않는 다른 입체(숨은 바탕)에서 오답을 만든다(오답이 그쪽에 모인다). 유형마다 아래 기준으로 검사한다.
// centerStats : 선지마다 나머지 4개와의 차이를 더한 값(차이 합). 정답의 차이 합이 최솟값이면(동률 포함) 중심 찍기가 통한다.
function centerStats(list, ansIdx, dist) {
  const sums = list.map((a, i) => list.reduce((s, b, k) => (k === i ? s : s + dist(a, b)), 0));
  const others = sums.filter((_, i) => i !== ansIdx);
  const ans = sums[ansIdx], minOther = Math.min(...others), maxOther = Math.max(...others);
  return { sums, ans, minOther, maxOther, rank: 1 + others.filter((v) => v < ans).length };
}
// 정답보다 차이 합이 작은 오답이 있어야 한다(= 정답이 최솟값도, 최솟값 동률도 아니다).
// 또 정답의 차이 합이 가장 크면(동률 포함) '가장 동떨어진 선지 고르기'가 통하므로, 정답보다 차이 합이 큰 오답도 있어야 한다.
const notCenter = (st) => st.minOther < st.ans;
const notOutlier = (st, strict = true) => (strict ? st.maxOther > st.ans : st.maxOther >= st.ans);
// majorityLost : 자리(칸·열·면)마다 가장 많은 선지가 가진 값을 고른다. 정답의 값이 그 자리 최다 득표보다 표가 적은 자리의 목록.
// 비어 있지 않으면 '자리별 다수결 조합'은 어떤 동률 처리로도 정답과 같아질 수 없다.
function majorityLost(list, ansIdx, slots) {
  const vals = list.map(slots);
  const lost = [];
  for (let p = 0; p < vals[0].length; p++) {
    const cnt = new Map();
    for (const v of vals) cnt.set(v[p], (cnt.get(v[p]) || 0) + 1);
    if (cnt.get(vals[ansIdx][p]) < Math.max(...cnt.values())) lost.push(p);
  }
  return lost;
}
const hmDist = (a, b) => a.reduce((s, r, y) => s + r.reduce((t, v, x) => t + Math.abs(v - b[y][x]), 0), 0); // 높이맵 칸별 높이 차이 합
const hmHam = (a, b) => a.reduce((s, r, y) => s + r.reduce((t, v, x) => t + (v !== b[y][x] ? 1 : 0), 0), 0); // 높이가 다른 칸 수
const hmSlots = (h) => h.flat().map(String);
// 투상도 격자 : 아래·왼쪽을 맞춰 겹쳤을 때 칠한 칸이 다른 격자 칸 수
function bmCells(b) { const s = new Set(); b.rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '1') s.add(`${c},${b.h - 1 - r}`); })); return s; }
function bmDist(a, b) { const A = bmCells(a), B = bmCells(b); let n = 0; for (const k of A) if (!B.has(k)) n++; for (const k of B) if (!A.has(k)) n++; return n; }
function bmSlots(W, H) { return (b) => { const s = bmCells(b); const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(s.has(`${x},${y}`) ? '1' : '0'); return out; }; }
// rng로 배열에서 서로 다른 원소 k개를 뽑는다.
function sampleK(rng, arr, k) {
  if (k > arr.length) return null;
  const idx = new Set();
  while (idx.size < k) idx.add(rng.int(arr.length));
  return [...idx].map((i) => arr[i]);
}

// ───────────────────── 1) 투상도 → 입체 ─────────────────────
function perturbHeightmaps(h, rng, maxH) {
  const Y = h.length, X = h[0].length;
  const cells = [];
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) cells.push([x, y]);
  const out = [];
  for (const [x, y] of cells) for (let v = 0; v <= maxH; v++) {
    if (v === h[y][x]) continue;
    const g = hmClone(h); g[y][x] = v; out.push({ h: g, op: 'set' });
  }
  for (const [x1, y1] of cells) {
    if (h[y1][x1] === 0) continue;
    for (const [x2, y2] of cells) {
      if ((x1 === x2 && y1 === y2) || h[y2][x2] >= maxH) continue;
      const g = hmClone(h); g[y1][x1]--; g[y2][x2]++; out.push({ h: g, op: 'move' });
    }
  }
  for (let i = 0; i < cells.length; i++) for (let k = i + 1; k < cells.length; k++) {
    const [x1, y1] = cells[i], [x2, y2] = cells[k];
    if (h[y1][x1] === h[y2][x2]) continue;
    const g = hmClone(h); g[y1][x1] = h[y2][x2]; g[y2][x2] = h[y1][x1]; out.push({ h: g, op: 'swap' });
  }
  for (let t = 0; t < 80; t++) {
    const g = hmClone(h);
    for (let m = 0; m < 2; m++) { const [x, y] = rng.pick(cells); g[y][x] = rng.range(0, maxH); }
    out.push({ h: g, op: 'set2' });
  }
  out.push({ h: h.map((r) => r.slice().reverse()), op: 'mirrorX' });
  out.push({ h: h.slice().reverse().map((r) => r.slice()), op: 'mirrorY' });
  return rng.shuffle(out);
}

function describeViewDiff(V, W, who) {
  const parts = []; // [투상도 이름, 문장]
  if (!arrEq(V.front, W.front)) {
    const i = V.front.findIndex((v, k) => v !== W.front[k]);
    parts.push(['정면도', `정면에서 보면 왼쪽에서 ${i + 1}번째 열이 ${W.front[i]}층으로 보여 정면도(${V.front[i]}층)와 다르다`]);
  }
  if (!arrEq(V.right, W.right)) {
    const i = V.right.findIndex((v, k) => v !== W.right[k]);
    parts.push(['우측면도', `오른쪽에서 보면 앞에서 ${i + 1}번째 줄이 ${W.right[i]}층으로 보여 우측면도(왼쪽에서 ${i + 1}번째 열, ${V.right[i]}층)와 다르다`]);
  }
  topLoop: for (let y = 0; y < V.top.length; y++) for (let x = 0; x < V.top[0].length; x++) {
    if (V.top[y][x] !== W.top[y][x]) {
      const where = `앞에서 ${y + 1}번째 줄, 왼쪽에서 ${x + 1}번째 칸`;
      parts.push(['평면도', W.top[y][x]
        ? `위에서 보면 ${where}에 블록이 있어 평면도와 다르다(평면도에서는 빈칸)`
        : `위에서 보면 ${where}이 비어 있어 평면도와 다르다`]);
      break topLoop;
    }
  }
  if (!parts.length) return `${j(who, '은/는')} 투상도와 다르다`;
  // 어긋난 투상도가 여럿이면 첫째만 자세히 쓰고 나머지는 이름만 덧붙인다
  const more = parts.slice(1).map((p) => p[0]);
  return `${j(who, '은/는')} ${parts[0][1]}${more.length ? `. ${more.join('·')}도 맞지 않는다` : ''}`;
}

// 높이맵 base에서 한 곳을 바꾼 오답 후보(정답 h의 투상도 V와 적어도 한 면이 달라야 한다)
const SINGLE_OPS = ['set', 'move', 'swap'];
function v2sPool(base, rng, cfg, ref) {
  const out = [];
  const seen = new Set(ref.exclude);
  for (const c of perturbHeightmaps(base, rng, cfg.maxH)) {
    const g = c.h, key = hmKey(g);
    if (seen.has(key)) continue;
    seen.add(key);
    if (g.length !== ref.Y || g[0].length !== ref.X) continue;
    const cg = hmCrop(g);
    if (cg.length !== ref.Y || cg[0].length !== ref.X) continue;
    if (!hmConnected(g) || hmMax(g) > cfg.maxH || !hmReadable(g)) continue;
    if (Math.abs(hmCount(g) - ref.N) > cfg.dCount) continue;
    const W = hmViews(g);
    const mk = mmKey(viewMismatch(ref.V, W));
    if (!mk) continue; // 세 투상도가 모두 같으면 또 하나의 정답이므로 오답으로 쓸 수 없다
    out.push({ v: g, key, W, mk, op: c.op, n: hmCount(g) });
  }
  return out;
}
const diffCells = (a, b) => { const s = new Set(); a.forEach((r, y) => r.forEach((v, x) => { if (v !== b[y][x]) s.add(x + ',' + y); })); return s; };
// 세 투상도가 정답과 똑같은 '숨은 바탕' 높이맵 B : 어떤 열의 정면도 높이와 어떤 줄의 우측면도 높이보다 낮은 기둥(가장 높은
// 기둥이 아닌 기둥)의 높이만 바꾼다. 칸 높이 차이 합이 2가 되게, 한 칸을 2 바꾸거나 두 칸을 1씩(블록 1개 옮기기) 바꾼다.
// B는 투상도로는 정답과 구별되지 않으므로 선지로 쓰지 않고, B에서 한 곳을 바꿔 투상도 하나가 어긋난 모양을 오답으로 쓴다.
function hiddenBases(h, V, cfg) {
  const Y = h.length, X = h[0].length;
  const same = (g) => { const W = hmViews(g); return arrEq(W.front, V.front) && arrEq(W.right, V.right) && topEq(W.top, V.top); };
  const out = [];
  const seen = new Set([hmKey(h)]);
  const push = (g, cells) => { const k = hmKey(g); if (!seen.has(k) && same(g)) { seen.add(k); out.push({ v: g, key: k, cells }); } };
  const cells = [];
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) if (h[y][x] > 0) cells.push([x, y]);
  for (const [x, y] of cells) for (const d of [-2, 2]) {
    const v = h[y][x] + d;
    if (v < 1 || v > cfg.maxH) continue;
    const g = hmClone(h); g[y][x] = v; push(g, [x + ',' + y]);
  }
  for (const [x1, y1] of cells) for (const [x2, y2] of cells) {
    if (x1 === x2 && y1 === y2) continue;
    const g = hmClone(h); g[y1][x1]--; g[y2][x2]++;
    if (g[y1][x1] < 1 || g[y2][x2] > cfg.maxH) continue;
    push(g, [x1 + ',' + y1, x2 + ',' + y2]);
  }
  return out;
}
/**
 * 투상도→입체 오답 4개 고르기. 두 가지 구조를 이 순서로 시도한다.
 *  (1) 숨은 바탕 : 오답 4개를 모두 B(투상도가 정답과 같은 다른 입체)에서 한 곳씩 바꿔 만든다. 정면도·우측면도·평면도만 어긋난 오답이
 *      하나씩 있어 세 투상도를 모두 봐야 풀린다.
 *  (2) 미끼 : D(정답에서 한 곳만 바꿔 한 면만 어긋남) + D에서 다시 한 곳을 바꾼 파생 오답 2개 + 정답에서 바로 바꾼 독립 오답 1개.
 *      세 투상도가 모두 쓰이고, 한 면만 어긋난 오답이 적어도 두 종류의 면에 있다(그 면을 건너뛰면 오답이 남는다).
 * 공통 조건 : 정답이 선지 집합의 중심도, 가장 동떨어진 선지도 아닐 것(칸별 높이 차이 합 기준, 다른 칸 수 기준도 중심은 아닐 것),
 *             칸별 다수결 조합이 정답과 다를 것, 모든 선지가 가시성 검사를 통과할 것.
 */
function pickV2sDistractors(h, rng, cfg, ref) {
  const visCache = new Map();
  const visOk = (c) => { if (!visCache.has(c.key)) visCache.set(c.key, checkVisibility(c.v).ok); return visCache.get(c.key); };
  const keyA = hmKey(h);
  let P1 = v2sPool(h, rng, cfg, { ...ref, exclude: [keyA] });
  // 어려운 문항은 블록 수가 같은 오답(옮기기·맞바꾸기)을 먼저 써서 개수만 세어 지우는 풀이를 막는다.
  if (cfg.hard) P1 = [...P1.filter((c) => c.n === ref.N), ...P1.filter((c) => c.n !== ref.N)];
  // 칸별 높이 차이 합(주 기준)은 정답이 최소도 최대도 아니어야 한다. 다른 칸 수(보조 기준)도 최소는 아니어야 하고,
  // 최대 동률은 strictH가 false일 때만 허용한다(한 번 바꾸기는 1~2칸뿐이라 숨은 바탕 구조에서는 최대 동률이 잦다).
  const scoreOk = (set, strictH) => {
    const all = [h, ...set.map((c) => c.v)];
    const st = centerStats(all, 0, hmDist), stH = centerStats(all, 0, hmHam);
    return notCenter(st) && notCenter(stH) && notOutlier(st) && notOutlier(stH, strictH) && majorityLost(all, 0, hmSlots).length > 0;
  };
  const isFar = (c) => c.op === 'mirrorX' || c.op === 'mirrorY';
  // (1) 숨은 바탕 B에서 만든 오답 4개 : 정면도·우측면도·평면도가 각각 하나만 어긋난 오답이 모두 있어 세 투상도를 다 봐야 풀린다
  //     (어려운 문항은 4개 모두 한 면만 어긋난다). 오답 4개가 B 쪽에 모여 정답이 중심에서 벗어난다.
  //     넷째 오답은 B에서 한 곳을 바꾼 것이나, 정답·B의 좌우·앞뒤를 뒤집은 모양(거울상)에서 고른다.
  const bases = rng.shuffle(hiddenBases(h, ref.V, cfg)).slice(0, 12).map((B) => {
    const raw = v2sPool(B.v, rng, cfg, { ...ref, exclude: [keyA, B.key] });
    let P3 = raw.filter((c) => SINGLE_OPS.includes(c.op) && ![...diffCells(c.v, B.v)].some((k) => B.cells.includes(k)));
    let far = [...P1, ...raw].filter(isFar);
    if (cfg.hard) { P3 = P3.filter((c) => c.mk.length === 1); far = far.filter((c) => c.mk.length === 1); }
    return { B, P3, far, byView: { F: P3.filter((c) => c.mk === 'F'), R: P3.filter((c) => c.mk === 'R'), T: P3.filter((c) => c.mk === 'T') } };
  }).filter((b) => b.byView.F.length && b.byView.R.length && b.byView.T.length);
  // (2) 미끼 D(정답에서 한 곳만 바꿔 한 면만 어긋남) + D에서 다시 한 곳을 바꾼 파생 오답 2개 + 정답에서 바로 바꾼 독립 오답 1개.
  //     파생 3개면 오답 4개가 모두 D의 어긋난 면 하나로 지워지므로 2개로 둔다.
  const decoys = P1.filter((c) => c.mk.length === 1 && SINGLE_OPS.includes(c.op) && hmDist(c.v, h) <= 2).slice(0, 40).map((D) => {
    const dCells = diffCells(D.v, h);
    const P2 = v2sPool(D.v, rng, cfg, { ...ref, exclude: [keyA, D.key] })
      .filter((c) => SINGLE_OPS.includes(c.op) && hmDist(c.v, D.v) <= 2 && ![...diffCells(c.v, D.v)].some((k) => dCells.has(k)))
      .filter((c) => !cfg.hard || Math.abs(c.n - ref.N) <= 1);
    return { D, P2, indep: P1.filter((c) => c.key !== D.key && (!cfg.hard || Math.abs(c.n - ref.N) <= 1)).slice(0, 60) };
  });
  const tryBase = (strictH) => {
    for (const { P3, far, byView } of bases) {
      for (let t = 0; t < 500; t++) {
        const fourth = far.length && t % 2 ? rng.pick(far) : rng.pick(P3);
        const set = [rng.pick(byView.F), rng.pick(byView.R), rng.pick(byView.T), fourth];
        if (new Set(set.map((c) => c.key)).size !== 4) continue;
        if (!scoreOk(set, strictH) || !set.every(visOk)) continue;
        return set.map((c) => ({ ...c, role: isFar(c) ? 'mirror' : 'base' }));
      }
    }
    return null;
  };
  const tryDecoy = (strictH) => {
    for (const { D, P2, indep } of decoys) {
      if (!visOk(D)) continue;
      for (let t = 0; t < 600; t++) {
        const der = sampleK(rng, P2, 2), ind = sampleK(rng, indep, 1);
        if (!der || !ind) continue;
        const set = [D, ...der, ...ind];
        if (new Set(set.map((c) => c.key)).size !== 4) continue;
        if (new Set(set.flatMap((c) => [...c.mk])).size !== 3) continue;
        if (new Set(set.filter((c) => c.mk.length === 1).map((c) => c.mk)).size < 2) continue;
        if (!scoreOk(set, strictH) || !set.every(visOk)) continue;
        return set.map((c, i) => ({ ...c, role: i === 0 ? 'decoy' : i <= 2 ? 'derived' : 'indep' }));
      }
    }
    return null;
  };
  return tryBase(true) || tryBase(false) || tryDecoy(true) || tryDecoy(false);
}

function buildViewsToSolid(ctx, no, cfg, ansPos) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = ctx.rng('v2s', no, attempt);
    let h;
    try { h = genHeightmap(rng, { ...cfg, needHole: true }); } catch (e) { if (e instanceof GenError) continue; throw e; }
    if (ctx.usedTops.has(bmKey(topBitmapOf(hmViews(h).top)))) continue; // 같은 회차에서 평면도가 겹치지 않게
    const X = h[0].length, Y = h.length, N = hmCount(h);
    const V = hmViews(h);
    const chosen = pickV2sDistractors(h, rng, cfg, { V, N, X, Y });
    if (!chosen) continue;
    const dist = rng.shuffle(chosen);
    const { list, meta } = placeChoices(h, dist, ansPos);
    // 검증: 세 투상도가 모두 일치하는 선지는 정답 하나뿐
    const matches = list.map((g) => mmKey(viewMismatch(V, hmViews(g))) === '');
    assert(matches.filter(Boolean).length === 1 && matches[ansPos - 1], `${ctx.id(no)} 투상도 일치 선지가 1개가 아님`);
    assert(new Set(list.map(hmKey)).size === 5, `${ctx.id(no)} 선지 중복`);
    list.forEach((g) => assert(checkVisibility(g).ok, `${ctx.id(no)} 선지 가시성`));
    // 검증: 정답이 선지 집합의 중심이 아니고, 칸별 다수결 조합이 정답과 다르다
    const st = centerStats(list, ansPos - 1, hmDist), stH = centerStats(list, ansPos - 1, hmHam);
    assert(notCenter(st) && notCenter(stH), `${ctx.id(no)} 정답이 선지 집합의 중심(차이 합 ${st.sums.join(',')})`);
    assert(notOutlier(st) && notOutlier(stH, false), `${ctx.id(no)} 정답이 가장 동떨어진 선지(차이 합 ${st.sums.join(',')})`);
    assert(majorityLost(list, ansPos - 1, hmSlots).length > 0, `${ctx.id(no)} 칸별 다수결 조합이 정답과 같음`);
    ctx.metric(no, '투상도→입체', '칸별 높이 차이', st, `다른 칸 수 기준 ${stH.ans}/${stH.minOther}`);
    ctx.usedTops.add(bmKey(topBitmapOf(V.top)));
    const choiceSvgs = isoSVGs(list, 24, { arrow: true }, list.map((g, i) => `${CIRC[i]} 블록 입체`));
    const wrongs = meta.map((m, i) => (m ? describeViewDiff(V, m.W, CIRC[i]) + '.' : null)).filter(Boolean);
    const explanation = `정답 ${CIRC[ansPos - 1]}: 정면도(왼쪽 열부터 ${V.front.join('·')}층), 우측면도(앞줄부터 ${V.right.join('·')}층), 평면도가 모두 일치하는 것은 ${CIRC[ansPos - 1]}뿐이다.<br>`
      + `풀이: 평면도로 블록이 놓인 칸을 먼저 정하고, 정면도로 열마다 가장 높은 층수를, 우측면도로 줄마다 가장 높은 층수를 확인한다. 우측면도에서는 그림의 왼쪽이 입체의 앞쪽이다.<br>`
      + wrongs.join('<br>');
    ctx.log(no, `블록 ${N}개 ${X}×${Y}×${cfg.maxH}, 오답 [${meta.map((m, i) => (m ? `${CIRC[i]}${m.role}:${m.mk}` : null)).filter(Boolean).join(' ')}], 3면 일치 선지 1개, 차이 합 ${st.sums.join('/')}`);
    return {
      _debug: { figure: h, choices: list },
      subtype: '투상도→입체',
      stem: '다음 투상도에 해당하는 입체도형으로 옳은 것은? (단, 선택지의 화살표 방향이 정면이다)',
      figure: { svg: threeViewSVG(h), caption: '제3각법: 평면도는 정면도 위에(평면도의 아래쪽이 정면), 우측면도는 정면도 오른쪽에(우측면도의 왼쪽이 정면) 배치' },
      choiceSvgs,
      answer: ansPos,
      explanation,
    };
  }
  throw new Error(`${ctx.id(no)} 투상도→입체 생성 실패`);
}

// ───────────────────── 2) 입체 → 투상도 ─────────────────────
const VIEW_NAME = { front: '정면도', right: '우측면도', top: '평면도' };
// 정면도·우측면도 문항의 읽기 쉬움 조건 : 정답을 정하는 기둥(열·줄마다 가장 높은 기둥)의 윗면은 온전히 보이고,
// 빈칸은 바닥이 온전히 보이는 것만 2개까지 둔다(빈칸은 정면도·우측면도 답과 무관하고 그림만 복잡하게 만든다).
// 일부가 가려진 윗면은 보통 문항에서는 허용하지 않고, 어려운 문항에서만 '앞쪽의 더 높은 기둥' 뒤에 1개까지 허용한다.
const SIDE_READ = (view, hard) => ({ critical: view, maxPartialTops: hard ? 1 : 0, fullFloor: true });
const SIDE_MAX_HOLES = 2;
const ordList = (idx) => idx.map((i) => i + 1).join('·');
function rowName(y, Y) { return y === 0 ? '맨 앞줄' : y === Y - 1 ? '맨 뒷줄' : `앞에서 ${y + 1}번째 줄`; }
function colName(x, X) { return x === 0 ? '맨 왼쪽 칸' : x === X - 1 ? '맨 오른쪽 칸' : `왼쪽에서 ${x + 1}번째 칸`; }
// 열(또는 줄)마다 가장 높은 기둥이 어디에 있는지 해설용으로 적는다.
function whereTallest(h, view) {
  const Y = h.length, X = h[0].length;
  const parts = [];
  if (view === 'front') {
    for (let x = 0; x < X; x++) {
      const m = Math.max(...h.map((r) => r[x]));
      const ys = []; for (let y = 0; y < Y; y++) if (h[y][x] === m) ys.push(y);
      parts.push(`${x + 1}열 ${ys.length === Y ? '모든 줄' : ys.length === 1 ? rowName(ys[0], Y) : `앞에서 ${ordList(ys)}번째 줄`}(${m}층)`);
    }
  } else {
    for (let y = 0; y < Y; y++) {
      const m = Math.max(...h[y]);
      const xs = []; for (let x = 0; x < X; x++) if (h[y][x] === m) xs.push(x);
      parts.push(`${rowName(y, Y)} ${xs.length === X ? '모든 칸' : xs.length === 1 ? colName(xs[0], X) : `왼쪽에서 ${ordList(xs)}번째 칸`}(${m}층)`);
    }
  }
  return parts.join(', ');
}
// 가장 높은 기둥이 맨 뒤 윤곽보다 높은(앞쪽에 있는) 열/줄의 번호
function hiddenMaxLines(h, view) {
  const Y = h.length, X = h[0].length, out = [];
  if (view === 'front') { for (let x = 0; x < X; x++) if (h[Y - 1][x] < Math.max(...h.map((r) => r[x]))) out.push(x); }
  else for (let y = 0; y < Y; y++) if (h[y][0] < Math.max(...h[y])) out.push(y);
  return out;
}
// 투상도 오답의 '한 곳 바꾸기' : 정면도·우측면도는 한 열의 높이를 1 바꾸거나 이웃한 두 열의 높이를 맞바꾸고,
// 평면도는 한 칸을 칠하거나 비운다(테두리 줄이 비거나 칸이 끊어지는 모양은 버린다). avoid에 든 자리는 건드리지 않는다.
function sideTweaks(arr, maxH, avoid = new Set()) {
  const out = [];
  for (let i = 0; i < arr.length; i++) for (const d of [-1, 1]) {
    const v = arr[i] + d;
    if (avoid.has(String(i)) || v < 1 || v > maxH + 1) continue;
    const g = arr.slice(); g[i] = v;
    out.push({ raw: g, pos: [String(i)] });
  }
  for (let i = 0; i + 1 < arr.length; i++) {
    if (arr[i] === arr[i + 1] || avoid.has(String(i)) || avoid.has(String(i + 1))) continue;
    const g = arr.slice(); [g[i], g[i + 1]] = [g[i + 1], g[i]];
    out.push({ raw: g, pos: [String(i), String(i + 1)] });
  }
  return out;
}
function topTweaks(T, avoid = new Set()) {
  const Y = T.length, X = T[0].length, out = [];
  for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    if (avoid.has(x + ',' + y)) continue;
    const g = T.map((r) => r.slice()); g[y][x] = 1 - g[y][x];
    if (!g.some((r) => r.some(Boolean))) continue;
    const gc = hmCrop(g);
    if (gc.length !== Y || gc[0].length !== X || !hmConnected(g)) continue;
    out.push({ raw: g, pos: [x + ',' + y] });
  }
  return out;
}
function describeSideDiff(g, arr, lab) {
  const d = [];
  for (let i = 0; i < arr.length; i++) if (g[i] !== arr[i]) d.push(i);
  if (d.length === 1) return `${lab} ${d[0] + 1}번째 열이 ${g[d[0]]}층으로 그려져 있지만 실제로는 ${arr[d[0]]}층`;
  if (d.length === 2 && d[1] === d[0] + 1 && g[d[0]] === arr[d[1]] && g[d[1]] === arr[d[0]]) return `${lab} ${d[0] + 1}번째와 ${d[1] + 1}번째 열의 높이가 서로 바뀐 모양`;
  return `${lab} ${ordList(d)}번째 열이 각각 ${d.map((i) => g[i]).join('·')}층으로 그려져 있지만 실제로는 ${d.map((i) => arr[i]).join('·')}층`;
}
function describeTopDiff(g, T) {
  const d = [];
  T.forEach((r, y) => r.forEach((v, x) => { if (g[y][x] !== v) d.push([x, y]); }));
  const where = ([x, y]) => `앞에서 ${y + 1}번째 줄, 왼쪽에서 ${x + 1}번째 칸`;
  if (d.length === 1) { const [x, y] = d[0]; return g[y][x] ? `${where(d[0])}이 칠해져 있지만 실제로는 블록이 없는 칸` : `${where(d[0])}에 블록이 있는데 빈칸으로 그린 모양`; }
  return d.map(([x, y]) => `${where([x, y])}은 ${g[y][x] ? '블록이 없는데 칠해져 있' : '블록이 있는데 비어 있'}`).join('고, ') + '는 모양';
}
/**
 * 투상도 오답 4개 : 개념 오답(좌우·앞뒤 뒤집기, 다른 방향에서 본 모양, 맨 뒤 윤곽만 본 모양) nConcept개
 * + 미끼 D(정답에서 한 곳만 바꾼 것) + D에서 다시 한 곳을 바꾼 파생 오답 + (자리가 남으면) 정답에서 한 곳을 바꾼 독립 오답.
 * 조건 : 정답이 선지 집합의 중심이 아닐 것(격자 칸 차이 합), 칸별 다수결 조합이 정답과 다를 것.
 */
function pickS2vDistractors(rng, ctx) {
  const { correct, concepts, base, tweaks, toBm, describe, nConcept, mustConcept } = ctx;
  const keyA = bmKey(correct);
  const conc = [];
  for (const c of concepts) if (bmKey(c.v) !== keyA && !conc.some((o) => bmKey(o.v) === bmKey(c.v))) conc.push(c); // 대칭 때문에 정답과 같아지는 오답은 버린다
  const must = conc.filter((c) => mustConcept && c === concepts[0]);
  const mk = (t, role) => ({ v: toBm(t.raw), raw: t.raw, pos: t.pos, why: describe(t.raw), kind: 'subtle', role });
  const P1 = rng.shuffle(tweaks(base)).map((t) => mk(t, 'indep')).filter((c) => bmKey(c.v) !== keyA);
  for (const D of P1.slice(0, 30)) {
    const P2 = tweaks(D.raw, new Set(D.pos)).map((t) => mk(t, 'derived')).filter((c) => ![keyA, bmKey(D.v)].includes(bmKey(c.v)));
    const indep = P1.filter((c) => c !== D);
    for (let t = 0; t < 300; t++) {
      const nC = Math.min(nConcept, conc.length);
      const rest = 3 - nC;
      if (rest < 1) break;
      const k = rest === 1 ? 1 : 1 + (t % rest); // 파생 오답은 적어도 1개
      const cs = must.length ? [...must, ...(sampleK(rng, conc.filter((c) => !must.includes(c)), nC - must.length) || [])] : sampleK(rng, conc, nC);
      const der = sampleK(rng, P2, k), ind = sampleK(rng, indep, rest - k);
      if (!cs || cs.length !== nC || !der || !ind) continue;
      const set = [...cs, { ...D, role: 'decoy' }, ...der, ...ind];
      if (new Set([keyA, ...set.map((c) => bmKey(c.v))]).size !== 5) continue;
      const all = [correct, ...set.map((c) => c.v)];
      const st = centerStats(all, 0, bmDist);
      if (!notCenter(st) || !notOutlier(st)) continue;
      const W = Math.max(...all.map((b) => b.w)), H = Math.max(...all.map((b) => b.h));
      if (!majorityLost(all, 0, bmSlots(W, H)).length) continue;
      return set;
    }
  }
  return null;
}
function buildSolidToView(ctx, no, cfg, ansPos) {
  const view = cfg.view;
  const read = view === 'top' ? {} : SIDE_READ(view, !!cfg.hard);
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = ctx.rng('s2v', no, attempt);
    let h;
    try {
      h = genHeightmap(rng, { ...cfg, needHole: view === 'top', read, ...(view === 'top' ? {} : { maxHoles: SIDE_MAX_HOLES }) });
    } catch (e) { if (e instanceof GenError) continue; throw e; }
    assert(checkVisibility(h, read).ok, `${ctx.id(no)} 입체 그림 읽기 쉬움 조건`);
    // 어려운 정면도·우측면도 문항은 그림의 맨 뒤 윤곽(정면도라면 맨 뒷줄, 우측면도라면 맨 왼쪽 열)만 베껴서는 풀리지 않게,
    // 적어도 한 열(줄)은 가장 높은 기둥이 그보다 앞쪽(오른쪽)에 있는 더미만 쓴다.
    if (cfg.hard && view !== 'top' && !hiddenMaxLines(h, view).length) continue;
    const V = hmViews(h);
    if (ctx.usedTops.has(bmKey(topBitmapOf(V.top)))) continue;
    const concepts = []; // {v: bitmap, why, kind}
    let correct, rightDesc, pickCtx;
    if (view === 'top') {
      correct = topBitmapOf(V.top);
      const T = V.top, Y = T.length;
      const flipUD = T.slice().reverse();
      const flipLR = T.map((r) => r.slice().reverse());
      concepts.push({ v: topBitmapOf(flipUD), why: '앞뒤가 뒤바뀐 모양으로, 맨 앞줄을 정면 표시(아래쪽)가 아니라 위쪽에 그린 것', kind: 'concept' });
      concepts.push({ v: topBitmapOf(flipLR), why: '좌우가 뒤바뀐 모양', kind: 'concept' });
      pickCtx = { base: T, tweaks: (g, avoid) => topTweaks(g, avoid), toBm: topBitmapOf, describe: (g) => describeTopDiff(g, T) };
      const rowsTxt = [];
      for (let y = 0; y < Y; y++) rowsTxt.push(T[y].map((v) => (v ? '■' : '□')).join(''));
      rightDesc = `위에서 내려다보면 높이와 관계없이 블록이 놓인 칸만 보인다. 앞줄부터 왼쪽→오른쪽 순서로 ${rowsTxt.join(' / ')}이다. 평면도는 정면(앞쪽)이 아래에 오도록 그리므로(선지의 '정면' 화살표 쪽) 맨 앞줄이 맨 아래 줄이 되고, 이에 맞는 것은 ${CIRC[ansPos - 1]}이다.`;
    } else {
      const arr = view === 'front' ? V.front : V.right;
      const other = view === 'front' ? V.right : V.front;
      correct = skyBitmap(arr);
      const hid = hiddenMaxLines(h, view);
      if (cfg.hard && hid.length) {
        // 맨 뒤 윤곽만 베낀 모양 : 앞쪽(오른쪽)에 있는 더 높은 기둥을 놓친 오답
        const Y = h.length;
        const sil = view === 'front' ? h[Y - 1].slice() : h.map((r) => r[0]);
        const i = hid[0];
        const missed = view === 'front'
          ? `왼쪽에서 ${i + 1}번째 열 ${rowName(h.map((r) => r[i]).lastIndexOf(arr[i]), Y)}의 ${arr[i]}층 기둥`
          : `${rowName(i, Y)} ${colName(h[i].lastIndexOf(arr[i]), h[0].length)}의 ${arr[i]}층 기둥`;
        concepts.push({ v: skyBitmap(sil), why: `${view === 'front' ? '맨 뒷줄' : '맨 왼쪽 열'} 기둥만 보고 그린 모양으로, 그보다 ${view === 'front' ? '앞쪽' : '오른쪽'}에 있는 더 높은 기둥(${missed})을 놓친 것`, kind: 'concept' });
      }
      concepts.push({ v: skyBitmap(arr.slice().reverse()), why: view === 'front' ? '좌우가 뒤바뀐 모양(뒤에서 본 모양)' : '좌우가 뒤바뀐 모양(왼쪽에서 본 모양)', kind: 'concept' });
      concepts.push({ v: skyBitmap(other), why: view === 'front' ? '오른쪽에서 본 모양(우측면도)' : '앞에서 본 모양(정면도)', kind: 'concept' });
      concepts.push({ v: skyBitmap(other.slice().reverse()), why: view === 'front' ? '왼쪽에서 본 모양(좌측면도)' : '뒤에서 본 모양', kind: 'concept' });
      const lab = view === 'front' ? '왼쪽에서' : '왼쪽(앞줄)에서';
      pickCtx = { base: arr, tweaks: (g, avoid) => sideTweaks(g, cfg.maxH, avoid), toBm: skyBitmap, describe: (g) => describeSideDiff(g, arr, lab) };
      rightDesc = view === 'front'
        ? `앞에서 보면 열마다 가장 높은 블록까지만 보인다. 열마다 가장 높은 기둥은 ${whereTallest(h, 'front')}이다. 왼쪽 열부터 가장 높은 층수가 ${arr.join('·')}층이므로 정면도는 ${CIRC[ansPos - 1]}이다.`
        : `오른쪽에서 보면 줄마다 가장 높은 블록까지만 보이고, 그림의 왼쪽이 입체의 앞쪽이 된다. 줄마다 가장 높은 기둥은 ${whereTallest(h, 'right')}이다. 앞줄부터 가장 높은 층수가 ${arr.join('·')}층이므로 우측면도는 ${CIRC[ansPos - 1]}이다.`;
    }
    const picked = pickS2vDistractors(rng, {
      ...pickCtx, correct, concepts, nConcept: cfg.hard ? 1 : 2,
      mustConcept: !!(cfg.hard && view !== 'top' && hiddenMaxLines(h, view).length), // 어려운 정면도·우측면도는 '맨 뒤 윤곽' 오답을 반드시 넣는다
    });
    if (!picked) continue;
    const dist = rng.shuffle(picked);
    const { list, meta } = placeChoices(correct, dist, ansPos);
    assert(new Set(list.map(bmKey)).size === 5, `${ctx.id(no)} 투상도 선지 중복`);
    assert(list.filter((b) => bmKey(b) === bmKey(correct)).length === 1, `${ctx.id(no)} 정답 투상도 유일성`);
    // 검증: 정답이 선지 집합의 중심이 아니고, 칸별 다수결 조합이 정답과 다르다
    const st = centerStats(list, ansPos - 1, bmDist);
    assert(notCenter(st) && notOutlier(st), `${ctx.id(no)} 정답이 선지 집합의 중심이거나 혼자 동떨어짐(차이 합 ${st.sums.join(',')})`);
    const gw = Math.max(...list.map((b) => b.w)), gh = Math.max(...list.map((b) => b.h));
    assert(majorityLost(list, ansPos - 1, bmSlots(gw, gh)).length > 0, `${ctx.id(no)} 칸별 다수결 조합이 정답과 같음`);
    ctx.metric(no, '입체→투상도', '격자 칸 차이', st);
    ctx.usedTops.add(bmKey(topBitmapOf(V.top)));
    const choiceSvgs = bitmapChoiceSVGs(list, list.map((_, i) => `${CIRC[i]} 격자 투상도`), { bottomAlign: view !== 'top', frontMark: view === 'top' });
    // 평면도는 위아래(앞뒤) 방향을 정하는 약속이 없으면 앞뒤를 뒤집은 선지도 맞다고 볼 수 있다.
    // 그래서 평면도 선지에는 모두 '정면' 표시를 넣고, 앞뒤를 뒤집은 오답이 있으면 발문·그림 설명에도 약속을 적는다.
    if (view === 'top') choiceSvgs.forEach((s, i) => assert(s.includes('>정면</text>'), `${ctx.id(no)} 평면도 선지 ${CIRC[i]} 정면 표시`));
    const wrongs = meta.map((m, i) => (m ? `${j(CIRC[i], '은/는')} ${m.why}이다.` : null)).filter(Boolean);
    const readTxt = view === 'top' ? '' : `, 빈칸 ${h.flat().filter((v) => v === 0).length}개(바닥 모두 보임), 답을 정하는 기둥 윗면 모두 보임`;
    ctx.log(no, `${VIEW_NAME[view]} 묻기, 블록 ${hmCount(h)}개${readTxt}, 오답 [${meta.map((m, i) => (m ? `${CIRC[i]}${m.role || m.kind}` : null)).filter(Boolean).join(' ')}], 정답 비트맵 유일, 차이 합 ${st.sums.join('/')}`);
    const dirWord = view === 'front' ? '앞에서 본 모양(정면도)' : view === 'right' ? '오른쪽에서 본 모양(우측면도)' : '위에서 본 모양(평면도)';
    return {
      _debug: { figure: h, choices: list.map((b) => b.rows) },
      subtype: '입체→투상도',
      stem: view === 'top'
        ? `다음 입체도형을 ${dirWord}으로 옳은 것은? (단, 화살표 방향이 정면이며, 평면도는 정면 쪽이 아래에 오도록 그린다)`
        : `다음 입체도형을 ${dirWord}으로 옳은 것은? (단, 화살표 방향이 정면이다)`,
      figure: { svg: isoSVGs([h], 28, { arrow: true }, ['블록 입체'])[0], caption: view === 'top' ? '평면도는 정면(앞쪽)이 아래에 오도록 그린다. 선지의 ‘정면’ 화살표가 입체의 정면 쪽이다.' : '' },
      choiceSvgs,
      answer: ansPos,
      explanation: `정답 ${CIRC[ansPos - 1]}: ${rightDesc}<br>` + wrongs.join('<br>'),
    };
  }
  throw new Error(`${ctx.id(no)} 입체→투상도 생성 실패`);
}

// ───────────────────── 3) 전개도 ─────────────────────
const vEq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const vNeg = (a) => [-a[0], -a[1], -a[2]];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mApply = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
const ROTATIONS = (() => {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const permSign = (p) => { let s = 1; for (let i = 0; i < 3; i++) for (let k = i + 1; k < 3; k++) if (p[i] > p[k]) s = -s; return s; };
  const out = [];
  for (const p of perms) for (let m = 0; m < 8; m++) {
    const sg = [m & 1 ? -1 : 1, m & 2 ? -1 : 1, m & 4 ? -1 : 1];
    if (permSign(p) * sg[0] * sg[1] * sg[2] !== 1) continue;
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) M[i][p[i]] = sg[i];
    out.push(M);
  }
  return out;
})();
const TOP = [0, 0, 1], FRONT = [0, -1, 0], RIGHT = [1, 0, 0];
const VIS = [['top', TOP], ['front', FRONT], ['right', RIGHT]];

// 정육면체 전개도 11종 [행, 열]
const NETS = [
  [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0]], // 1-4-1
  [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]],
  [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 2]],
  [[0, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 3]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3], [2, 1]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [2, 1]], // 2-3-1
  [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3], [2, 3]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3]], // 2-2-2
  [[0, 0], [0, 1], [0, 2], [1, 2], [1, 3], [1, 4]], // 3-3
];
// 방향이 분명한(회전·반사 대칭이 없는) 기호. 단위 상자 [-0.5,0.5]², y 아래 방향.
// L은 180° 돌리면 한글 'ㄱ', 그대로 두면 'ㄴ'처럼 보여 다른 기호로 오해하기 쉬우므로 쓰지 않고, 어느 방향으로 돌려도
// 숫자 4로 읽히는 '4'(닫힌 모양)를 쓴다.
const GLYPHS = {
  F: 'M-0.18 0.36V-0.36H0.24M-0.18 -0.02H0.14',
  G: 'M0.26 -0.21A0.32 0.36 0 1 0 0.3 0.12V0.02H0.06',
  J: 'M0.16 -0.36V0.14A0.2 0.2 0 0 1 -0.24 0.14',
  4: 'M0.1 0.36V-0.36L-0.26 0.14H0.26',
  P: 'M-0.2 0.36V-0.36H0.06A0.18 0.18 0 0 1 0.06 0H-0.2',
  R: 'M-0.2 0.36V-0.36H0.06A0.18 0.18 0 0 1 0.06 0H-0.2M0.0 0L0.24 0.36',
};
const LETTERS = ['F', 'G', 'J', '4', 'P', 'R']; // 순서 고정(객체 키 순서는 숫자 키가 앞으로 온다)
assert(LETTERS.every((L) => GLYPHS[L]) && LETTERS.length === Object.keys(GLYPHS).length, '전개도 기호 목록');
const glyphPath = (L, sw = 0.1) => `<path d="${GLYPHS[L]}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;

function foldNet(cells) {
  const key = (r, c) => r + ',' + c;
  const idx = new Map(cells.map(([r, c], i) => [key(r, c), i]));
  const fr = new Array(cells.length);
  fr[0] = { n: [0, 0, 1], rt: [1, 0, 0], up: [0, 1, 0] };
  const queue = [0];
  while (queue.length) {
    const i = queue.shift();
    const [r, c] = cells[i];
    const F = fr[i];
    const moves = [
      [r, c + 1, () => ({ n: F.rt, rt: vNeg(F.n), up: F.up })],
      [r, c - 1, () => ({ n: vNeg(F.rt), rt: F.n, up: F.up })],
      [r - 1, c, () => ({ n: F.up, up: vNeg(F.n), rt: F.rt })],
      [r + 1, c, () => ({ n: vNeg(F.up), up: F.n, rt: F.rt })],
    ];
    for (const [rr, cc, mk] of moves) {
      const k = idx.get(key(rr, cc));
      if (k !== undefined && !fr[k]) { fr[k] = mk(); queue.push(k); }
    }
  }
  assert(fr.every(Boolean), '전개도가 연결되어 있지 않음');
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) assert(!vEq(fr[a].n, fr[b].n), '전개도를 접으면 면이 겹침(정육면체 전개도 아님)');
  return fr;
}
function transformNet(cells, rot, mirror) {
  let pts = cells.map(([r, c]) => [r, mirror ? -c : c]);
  for (let t = 0; t < rot; t++) pts = pts.map(([r, c]) => [c, -r]);
  const mr = Math.min(...pts.map((p) => p[0])), mc = Math.min(...pts.map((p) => p[1]));
  return pts.map(([r, c]) => [r - mr, c - mc]);
}
// k: 전개도에서 기호를 시계 방향으로 90°×k 돌림
function glyphUp(F, k) { return [F.up, F.rt, vNeg(F.up), vNeg(F.rt)][k]; }
function cubeFaces(cells, letters, ks) {
  const fr = foldNet(cells);
  return fr.map((F, i) => ({ letter: letters[i], n: F.n, gu: glyphUp(F, ks[i]), cell: cells[i], k: ks[i] }));
}
function specFromRotation(faces, R) {
  const spec = {};
  for (const f of faces) {
    const n2 = mApply(R, f.n);
    for (const [name, D] of VIS) if (vEq(n2, D)) spec[name] = { letter: f.letter, gu: mApply(R, f.gu), mirror: false };
  }
  return spec;
}
const specKey = (s) => VIS.map(([nm]) => `${s[nm].letter}${s[nm].gu.join('')}${s[nm].mirror ? 'm' : ''}`).join('|');
function matchingRotations(spec, faces, { ignoreGlyph = false } = {}) {
  const out = [];
  for (const R of ROTATIONS) {
    let ok = true;
    for (const [nm, D] of VIS) {
      const f = faces.find((ff) => vEq(mApply(R, ff.n), D));
      const s = spec[nm];
      if (f.letter !== s.letter) { ok = false; break; }
      if (!ignoreGlyph && (s.mirror || !vEq(mApply(R, f.gu), s.gu))) { ok = false; break; }
    }
    if (ok) out.push(R);
  }
  return out;
}
const isPossible = (spec, faces) => matchingRotations(spec, faces).length > 0;
function rotAbout(D, v, q) { let r = v; for (let i = 0; i < q; i++) r = vCross(D, r); return r; }

function cubeChoiceSVG(spec, label) {
  const S = 74, pad = 10;
  const ox = pad, oy = pad + 1.5 * S;
  const P = (x, y, z) => [ox + (x + y) * C30 * S, oy + ((x - y) / 2 - z) * S];
  const PV = (v) => [(v[0] + v[1]) * C30 * S, ((v[0] - v[1]) / 2 - v[2]) * S];
  const facesDef = {
    top: { pts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], c: [0.5, 0.5, 1], n: TOP, fill: SHADE[0] },
    front: { pts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], c: [0.5, 0, 0.5], n: FRONT, fill: SHADE[1] },
    right: { pts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], c: [1, 0.5, 0.5], n: RIGHT, fill: SHADE[2] },
  };
  let body = '';
  for (const [nm] of VIS) {
    const fd = facesDef[nm];
    const q = fd.pts.map((p) => P(...p));
    body += `<polygon points="${q.map(([a, b]) => fmt(a) + ',' + fmt(b)).join(' ')}" fill="${fd.fill}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
    const s = spec[nm];
    const gr = s.mirror ? vCross(fd.n, s.gu) : vCross(s.gu, fd.n);
    const k = 0.72;
    const A = PV(gr), U = PV(s.gu), C = P(...fd.c);
    const m = [A[0] * k, A[1] * k, -U[0] * k, -U[1] * k, C[0], C[1]].map((v) => Math.round(v * 1000) / 1000);
    body += `<g transform="matrix(${m.join(' ')})">${glyphPath(s.letter, 0.08)}</g>`;
  }
  const W = 2 * C30 * S + 2 * pad, H = 2 * S + 2 * pad;
  return svgDoc(W, H, body, label);
}
function netSVG(faces) {
  const s = 46, pad = 10;
  const R = Math.max(...faces.map((f) => f.cell[0])) + 1, Cc = Math.max(...faces.map((f) => f.cell[1])) + 1;
  let body = '';
  for (const f of faces) {
    const [r, c] = f.cell;
    body += `<rect x="${pad + c * s}" y="${pad + r * s}" width="${s}" height="${s}" fill="#fff" stroke="${INK}" stroke-width="2"/>`;
    body += `<g transform="translate(${fmt(pad + c * s + s / 2)} ${fmt(pad + r * s + s / 2)}) rotate(${90 * f.k}) scale(${fmt(s * 0.7)})">${glyphPath(f.letter)}</g>`;
  }
  return svgDoc(Cc * s + 2 * pad, R * s + 2 * pad, body, '정육면체 전개도');
}
function explainImpossible(spec, faces) {
  const letters = VIS.map(([nm]) => spec[nm].letter);
  const byL = (L) => faces.find((f) => f.letter === L);
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const fa = byL(letters[a]), fb = byL(letters[b]);
    if (vEq(fa.n, vNeg(fb.n))) return { kind: 'opposite', text: `서로 마주 보는 면인 ${j(letters[a], '과/와')} ${j(letters[b], '이/가')} 동시에 보이므로 만들 수 없다` };
    if (fa === fb) return { kind: 'dup', text: `같은 면 ${j(letters[a], '이/가')} 두 번 나오므로 만들 수 없다` };
  }
  const mir = VIS.find(([nm]) => spec[nm].mirror);
  if (mir) return { kind: 'mirror', text: `${spec[mir[0]].letter} 기호가 뒤집힌(거울에 비친) 모양이다. 전개도를 접어도 면의 기호가 뒤집히지는 않으므로 만들 수 없다` };
  const Rs = matchingRotations(spec, faces, { ignoreGlyph: true });
  if (Rs.length === 0) {
    return { kind: 'order', text: `${letters.join(', ')} 세 면이 한 꼭짓점에 모이는 순서가 전개도와 반대(거울상)이므로 만들 수 없다` };
  }
  const R = Rs[0];
  const Rinv = ROTATIONS.find((M) => { const t = mApply(M, mApply(R, [1, 2, 3])); return t[0] === 1 && t[1] === 2 && t[2] === 3; });
  for (const [nm, D] of VIS) {
    const f = faces.find((ff) => vEq(mApply(R, ff.n), D));
    const s = spec[nm];
    if (!vEq(mApply(R, f.gu), s.gu)) {
      const shownN = mApply(Rinv, s.gu); // 그림에서 기호 머리가 향한 방향(원래 정육면체 좌표)
      const trueN = f.gu;
      const nb = (n) => faces.find((ff) => vEq(ff.n, n)).letter;
      return { kind: 'rot', text: `세 면의 배치는 가능하지만, ${f.letter} 기호의 위쪽(머리)이 ${nb(trueN)} 면 쪽을 향해야 하는데 ${nb(shownN)} 면 쪽을 향하고 있어 만들 수 없다` };
    }
  }
  return { kind: '?', text: '만들 수 없다' };
}
// 보이는 면의 기호마다 '위쪽(머리) 변에 붙는 면'을 적은 절(마침표 없음)
function relationClauses(spec, faces, count = 2) {
  const parts = [];
  for (const [nm] of VIS.slice(0, count)) {
    const f = faces.find((ff) => ff.letter === spec[nm].letter);
    const upN = f.gu;
    const nb = faces.find((ff) => vEq(ff.n, upN));
    parts.push(`${f.letter} 기호의 위쪽(머리) 변에는 ${nb.letter} 면이 붙는다`);
  }
  return parts;
}
// 정육면체 선지 비교 : 보이는 세 면(윗면·정면·우측면) 자리마다 (기호, 방향, 뒤집힘)이 다르면 1
const faceTuple = (s, nm) => `${s[nm].letter}${s[nm].gu.join('')}${s[nm].mirror ? 'm' : ''}`;
const specDist = (a, b) => VIS.reduce((n, [nm]) => n + (faceTuple(a, nm) !== faceTuple(b, nm) ? 1 : 0), 0);
const specSlots = (s) => VIS.map(([nm]) => faceTuple(s, nm));
const letterSlots = (s) => VIS.map(([nm]) => s[nm].letter);
// 정육면체 모양 S에서 한 곳을 바꾼 변형 : 한 면의 기호 돌리기, 두 면의 기호 맞바꾸기, 한 면을 보이지 않는 면의 기호로 바꾸기, 한 면의 기호 뒤집기.
// pos : 바뀐 자리(윗면·정면·우측면). avoid에 든 자리는 건드리지 않는다.
function netMods(S, faces, rng, avoid = new Set()) {
  const out = [];
  for (const [nm, D] of VIS) for (const q of [1, 2, 3]) {
    if (avoid.has(nm)) continue;
    const s = structuredClone(S); s[nm].gu = rotAbout(D, s[nm].gu, q); out.push({ v: s, op: 'rot', pos: [nm] });
  }
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const na = VIS[a][0], nb = VIS[b][0];
    if (avoid.has(na) || avoid.has(nb)) continue;
    const s = structuredClone(S); [s[na].letter, s[nb].letter] = [s[nb].letter, s[na].letter]; out.push({ v: s, op: 'swap', pos: [na, nb] });
  }
  const hidden = faces.filter((f) => !VIS.some(([nm]) => S[nm].letter === f.letter));
  for (const [nm, D] of VIS) for (const hf of hidden) {
    if (avoid.has(nm)) continue;
    const s = structuredClone(S); s[nm].letter = hf.letter; s[nm].gu = rotAbout(D, s[nm].gu, rng.int(4)); out.push({ v: s, op: 'replace', pos: [nm] });
  }
  for (const [nm] of VIS) {
    if (avoid.has(nm) || S[nm].mirror) continue;
    const s = structuredClone(S); s[nm].mirror = true; out.push({ v: s, op: 'mirror', pos: [nm] });
  }
  return out;
}
/**
 * '만들 수 있는 것' 오답 4개 : 미끼 D(정답에서 기호 글자를 바꾼 것 — 두 면 맞바꾸기 또는 숨은 면 기호로 바꾸기, 이웃 순서 오류)
 * + D의 나머지 자리를 다시 바꾼 파생 오답 k개(2~3) + 정답에서 바로 바꾼 독립 오답(기호 방향 오류 'rot' 포함).
 * 조건 : 모두 만들 수 없는 모양(24회전 전수 검사), 오답 이유가 3종류 이상이고 기호 방향(rot) 오류를 포함,
 *        정답이 선지 집합의 중심이 아님, 면 자리별 (기호, 방향) 다수결 조합과 기호만의 다수결 조합이 모두 정답과 다름.
 */
function pickNetCanDistractors(S0, faces, rng) {
  const keyA = specKey(S0);
  const impossible = (list, exclude) => {
    const seen = new Set(exclude), out = [];
    for (const m of list) {
      const key = specKey(m.v);
      if (seen.has(key) || isPossible(m.v, faces)) continue;
      seen.add(key);
      out.push({ ...m, key, why: explainImpossible(m.v, faces) });
    }
    return out;
  };
  const imp1 = impossible(rng.shuffle(netMods(S0, faces, rng)), [keyA]);
  const decoys = imp1.filter((m) => (m.op === 'swap' || m.op === 'replace') && m.why.kind === 'order');
  for (const D of decoys) {
    const imp2 = impossible(rng.shuffle(netMods(D.v, faces, rng, new Set(D.pos))), [keyA, D.key]);
    const indep = imp1.filter((m) => m !== D);
    for (let t = 0; t < 400; t++) {
      const k = t % 3 === 2 ? 3 : 2;
      const der = sampleK(rng, imp2, k), ind = sampleK(rng, indep, 3 - k);
      if (!der || !ind) continue;
      const set = [{ ...D, role: 'decoy' }, ...der.map((m) => ({ ...m, role: 'derived' })), ...ind.map((m) => ({ ...m, role: 'indep' }))];
      if (new Set([keyA, ...set.map((m) => m.key)]).size !== 5) continue;
      const kinds = new Set(set.map((m) => m.why.kind));
      if (!kinds.has('rot') || kinds.size < 3) continue;
      const all = [S0, ...set.map((m) => m.v)];
      const st = centerStats(all, 0, specDist);
      if (!notCenter(st) || !notOutlier(st)) continue;
      if (!majorityLost(all, 0, specSlots).length || !majorityLost(all, 0, letterSlots).length) continue;
      return set;
    }
  }
  return null;
}
function oppositeText(faces) {
  const seen = new Set();
  const out = [];
  for (const f of faces) {
    if (seen.has(f.letter)) continue;
    const o = faces.find((g) => vEq(g.n, vNeg(f.n)));
    seen.add(f.letter); seen.add(o.letter);
    out.push(`${f.letter}–${o.letter}`);
  }
  return out.join(', ');
}

function buildNet(ctx, no, cfg, ansPos) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const rng = ctx.rng('net', no, attempt);
    const cells = transformNet(NETS[cfg.net], rng.int(4), rng.chance(0.5));
    // 전개도의 첫 칸이 BFS 시작점이 되도록 칸 순서는 그대로 둔다
    const letters = rng.shuffle(LETTERS);
    const ks = cells.map(() => rng.int(4));
    const faces = cubeFaces(cells, letters, ks);
    const possibleSpecs = rng.shuffle(ROTATIONS).map((R) => specFromRotation(faces, R));
    if (cfg.mode === 'can') {
      const S0 = possibleSpecs[0];
      const chosen = pickNetCanDistractors(S0, faces, rng);
      if (!chosen) continue;
      const { list, meta } = placeChoices(S0, rng.shuffle(chosen), ansPos);
      const poss = list.map((s) => isPossible(s, faces));
      assert(poss.filter(Boolean).length === 1 && poss[ansPos - 1], `${ctx.id(no)} 전개도: 가능한 선지가 1개가 아님`);
      assert(new Set(list.map(specKey)).size === 5, `${ctx.id(no)} 전개도 선지 중복`);
      // 검증: 정답이 선지 집합의 중심이 아니고, 면 자리별 (기호, 방향) 다수결 조합과 기호 다수결 조합이 정답과 다르다
      const st = centerStats(list, ansPos - 1, specDist);
      assert(notCenter(st) && notOutlier(st), `${ctx.id(no)} 정답이 선지 집합의 중심이거나 혼자 동떨어짐(차이 합 ${st.sums.join(',')})`);
      assert(majorityLost(list, ansPos - 1, specSlots).length > 0, `${ctx.id(no)} 면 자리별 (기호, 방향) 다수결 조합이 정답과 같음`);
      assert(majorityLost(list, ansPos - 1, letterSlots).length > 0, `${ctx.id(no)} 면 자리별 기호 다수결 조합이 정답과 같음`);
      ctx.metric(no, '전개도(만들 수 있는 것)', '보이는 세 면 (기호, 방향) 불일치', st);
      ctx.log(no, `전개도 #${cfg.net + 1}, '만들 수 있는 것' — 24회전 전수검사: 가능 ${poss.filter(Boolean).length}/5, 오답 [${meta.map((m, i) => (m ? `${CIRC[i]}${m.role}:${m.why.kind}` : null)).filter(Boolean).join(' ')}], 차이 합 ${st.sums.join('/')}`);
      const wrongs = meta.map((m, i) => (m ? `${j(CIRC[i], '은/는')} ${m.why.text}.` : null)).filter(Boolean);
      return {
        subtype: '전개도',
        stem: '다음 전개도를 접어 만들 수 있는 정육면체는?',
        figure: { svg: netSVG(faces), caption: '' },
        choiceSvgs: list.map((s, i) => cubeChoiceSVG(s, `${CIRC[i]} 정육면체`)),
        answer: ansPos,
        explanation: `정답 ${CIRC[ansPos - 1]}: 전개도를 접으면 마주 보는 면은 ${oppositeText(faces)}이다. ${CIRC[ansPos - 1]}에 보이는 세 면은 서로 이웃한다. ${relationClauses(S0, faces).map((t) => t + '.').join(' ')} 이 관계가 전개도와 모두 맞는다.<br>` + wrongs.join('<br>'),
      };
    } else {
      // '만들 수 없는 것' : 가능한 모양 4개 + 불가능한 모양 1개
      const okSpecs = [];
      const keys = new Set();
      for (const s of possibleSpecs) {
        const k = specKey(s);
        if (keys.has(k)) continue;
        // 보이는 세 면의 글자 조합이 서로 겹치지 않게 골라 다양성을 높인다
        const ls = VIS.map(([nm]) => s[nm].letter).sort().join('');
        if (okSpecs.some((o) => VIS.map(([nm]) => o[nm].letter).sort().join('') === ls)) continue;
        keys.add(k); okSpecs.push(s);
        if (okSpecs.length === 5) break;
      }
      if (okSpecs.length < 5) continue;
      const base = okSpecs[4];
      const cands = [];
      for (const [nm, D] of VIS) for (const q of [1, 2, 3]) { const s = structuredClone(base); s[nm].gu = rotAbout(D, s[nm].gu, q); cands.push(s); }
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        const s = structuredClone(base); const na = VIS[a][0], nb = VIS[b][0];
        [s[na].letter, s[nb].letter] = [s[nb].letter, s[na].letter]; cands.push(s);
      }
      const prefer = cfg.hard ? ['rot'] : ['order', 'rot'];
      const imp = rng.shuffle(cands).filter((s) => !isPossible(s, faces)).map((s) => ({ v: s, why: explainImpossible(s, faces) }));
      const bad = imp.find((x) => prefer.includes(x.why.kind) && !keys.has(specKey(x.v)));
      if (!bad) continue;
      const goods = okSpecs.slice(0, 4).map((s) => ({ v: s }));
      const list = [];
      let g = 0;
      for (let i = 1; i <= 5; i++) list.push(i === ansPos ? bad.v : goods[g++].v);
      const poss = list.map((s) => isPossible(s, faces));
      assert(poss.filter((p) => !p).length === 1 && !poss[ansPos - 1], `${ctx.id(no)} 전개도: 불가능한 선지가 1개가 아님`);
      assert(new Set(list.map(specKey)).size === 5, `${ctx.id(no)} 전개도 선지 중복`);
      // 정답(만들 수 없는 모양)이 선지 집합의 중심이면 다른 시도로 넘어간다. 서로 다른 회전으로 본 정육면체 두 개는 보이는 세 면
      // 자리가 모두 다르므로(한 자리의 기호·방향이 같으면 회전이 하나로 정해진다) 가능한 선지끼리의 차이는 늘 3이다. 그래서 이 유형은
      // 차이 합이 모두 같은(중심 찍기가 아무것도 가리키지 못하는) 경우가 대부분이고, 정답이 혼자 최솟값인 경우만 버린다.
      const st = centerStats(list, ansPos - 1, specDist);
      if (st.minOther > st.ans || st.maxOther < st.ans) continue;
      ctx.metric(no, '전개도(만들 수 없는 것)', '보이는 세 면 (기호, 방향) 불일치', st, '', { tieOk: true });
      ctx.log(no, `전개도 #${cfg.net + 1}, '만들 수 없는 것' — 24회전 전수검사: 불가능 ${poss.filter((p) => !p).length}/5 (${bad.why.kind}), 차이 합 ${st.sums.join('/')}`);
      const others = list.map((s, i) => (i === ansPos - 1 ? null : `${CIRC[i]} ${relationClauses(s, faces, 1)[0]}`)).filter(Boolean);
      return {
        subtype: '전개도',
        stem: '다음 전개도를 접어 만들 수 없는 정육면체는?',
        figure: { svg: netSVG(faces), caption: '' },
        choiceSvgs: list.map((s, i) => cubeChoiceSVG(s, `${CIRC[i]} 정육면체`)),
        answer: ansPos,
        explanation: `정답 ${CIRC[ansPos - 1]}: ${bad.why.text}.<br>전개도를 접으면 마주 보는 면은 ${oppositeText(faces)}이다. 나머지 선지는 접은 정육면체를 돌려서 볼 수 있는 모양이다(예: ${others.join(' / ')}).`,
      };
    }
  }
  throw new Error(`${ctx.id(no)} 전개도 생성 실패`);
}

// ───────────────────── 4) 종이 접기 ─────────────────────
const pk = (c, r) => c + ',' + r;
const pu = (k) => k.split(',').map(Number);
function bboxOf(keys) {
  const ps = [...keys].map(pu);
  return { c0: Math.min(...ps.map((p) => p[0])), c1: Math.max(...ps.map((p) => p[0])), r0: Math.min(...ps.map((p) => p[1])), r1: Math.max(...ps.map((p) => p[1])) };
}
function planFolds(plan) {
  // 반환: steps[i] = { ...fold, O(접기 전 점유), A(접히는 쪽), f, g(평행이동 오류), f2(다른 대각선 오류), diag }
  let O = new Set();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) O.add(pk(c, r));
  const steps = [];
  for (const fd of plan) {
    const bb = bboxOf(O);
    let A, f, g = null, f2 = null, onDiag = () => false, kept = null;
    if (fd.t === 'v') {
      const k = fd.k;
      A = new Set([...O].filter((p) => (fd.flap === 'L' ? pu(p)[0] < k : pu(p)[0] >= k)));
      f = ([c, r]) => [2 * k - 1 - c, r];
      const sh = fd.flap === 'L' ? k - bb.c0 : bb.c1 + 1 - k;
      g = fd.flap === 'L' ? ([c, r]) => [c - sh, r] : ([c, r]) => [c + sh, r];
    } else if (fd.t === 'h') {
      const k = fd.k;
      A = new Set([...O].filter((p) => (fd.flap === 'T' ? pu(p)[1] < k : pu(p)[1] >= k)));
      f = ([c, r]) => [c, 2 * k - 1 - r];
      const sh = fd.flap === 'T' ? k - bb.r0 : bb.r1 + 1 - k;
      g = fd.flap === 'T' ? ([c, r]) => [c, r - sh] : ([c, r]) => [c, r + sh];
    } else {
      const n = bb.c1 - bb.c0 + 1;
      assert(n === bb.r1 - bb.r0 + 1 && O.size === n * n, '대각선 접기는 정사각형 상태에서만');
      const { c0, r0 } = bb;
      if (fd.d === '\\') {
        onDiag = ([c, r]) => c - c0 === r - r0;
        A = new Set([...O].filter((p) => { const [c, r] = pu(p); return fd.flap === 'U' ? c - c0 > r - r0 : c - c0 < r - r0; }));
        f = ([c, r]) => [c0 + (r - r0), r0 + (c - c0)];
        f2 = ([c, r]) => [c0 + n - 1 - (r - r0), r0 + n - 1 - (c - c0)];
        kept = fd.flap === 'U' ? 'LL' : 'UR';
      } else {
        onDiag = ([c, r]) => c - c0 + r - r0 === n - 1;
        A = new Set([...O].filter((p) => { const [c, r] = pu(p); return fd.flap === 'U' ? c - c0 + r - r0 < n - 1 : c - c0 + r - r0 > n - 1; }));
        f = ([c, r]) => [c0 + n - 1 - (r - r0), r0 + n - 1 - (c - c0)];
        f2 = ([c, r]) => [c0 + (r - r0), r0 + (c - c0)];
        kept = fd.flap === 'U' ? 'LR' : 'UL';
      }
    }
    const fA = new Set([...A].map((p) => pk(...f(pu(p)))));
    for (const p of fA) assert(O.has(p) && !A.has(p), '접힌 부분이 종이 밖으로 나감');
    const after = new Set([...O].filter((p) => !A.has(p)));
    steps.push({ ...fd, O, A, fA, f, g, f2, onDiag, kept, bb });
    O = after;
  }
  return { steps, final: O };
}
function paperForward(plan, steps) {
  // 원래 칸마다 현재 위치를 추적한다(층 정보 = 같은 위치에 겹친 원래 칸들)
  const layers = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) layers.push({ orig: [c, r], pos: [c, r] });
  const snaps = [];
  const snap = (diagStep) => {
    const m = new Map();
    for (const L of layers) { const k = pk(...L.pos); m.set(k, (m.get(k) || 0) + 1); }
    const cells = [...m].map(([k, n]) => {
      const [c, r] = pu(k);
      const tri = diagStep && diagStep.onDiag([c, r]) ? diagStep.kept : null;
      return { c, r, layers: tri ? n * 2 : n, tri };
    });
    return cells;
  };
  snaps.push(snap(null));
  steps.forEach((st) => {
    for (const L of layers) if (st.A.has(pk(...L.pos))) L.pos = st.f(L.pos);
    snaps.push(snap(st.t === 'd' ? st : null));
  });
  return { layers, snaps };
}
function unfold(steps, holes, errors = {}) {
  let P = new Set(holes.map((h) => pk(...h)));
  const counts = [P.size];
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    const next = new Set();
    for (const p of P) {
      const q = pu(p);
      if (st.O.has(p) && !st.A.has(p)) next.add(p);
      if (st.fA.has(p)) {
        const e = errors[i];
        if (!e) next.add(pk(...st.f(q)));
        else if (e === 'translate') next.add(pk(...st.g(q)));
        else if (e === 'otherDiag') next.add(pk(...st.f2(q)));
        else if (e === 'skip') { /* 겹친 층의 구멍을 빠뜨림 */ }
      }
    }
    P = next;
    counts.push(P.size);
  }
  return { set: P, counts };
}
const holeKey = (set) => [...set].sort().join(';');
const holeDist = (a, b) => { let n = 0; for (const k of a) if (!b.has(k)) n++; for (const k of b) if (!a.has(k)) n++; return n; }; // 구멍 위치가 다른 칸 수
const paperSlots = (set) => { const out = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out.push(set.has(pk(c, r)) ? '1' : '0'); return out; };

function paperStateBody(cells, ox, oy, s) {
  let fills = '', segs = new Map();
  const addSeg = (a, b) => {
    const k1 = `${fmt(a[0])},${fmt(a[1])}`, k2 = `${fmt(b[0])},${fmt(b[1])}`;
    const k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
    segs.set(k, (segs.get(k) || 0) + 1);
  };
  const shade = (n) => (n <= 1 ? '#ffffff' : n === 2 ? '#e3e3e3' : '#c4c4c4');
  let grid = '';
  for (const cl of cells) {
    const x = ox + cl.c * s, y = oy + cl.r * s;
    const TL = [x, y], TR = [x + s, y], BR = [x + s, y + s], BL = [x, y + s];
    let poly;
    if (!cl.tri) poly = [TL, TR, BR, BL];
    else if (cl.tri === 'LL') poly = [TL, BR, BL];
    else if (cl.tri === 'UR') poly = [TL, TR, BR];
    else if (cl.tri === 'LR') poly = [TR, BR, BL];
    else poly = [TL, TR, BL];
    fills += `<polygon points="${poly.map((p) => fmt(p[0]) + ',' + fmt(p[1])).join(' ')}" fill="${shade(cl.layers)}"/>`;
    for (let i = 0; i < poly.length; i++) addSeg(poly[i], poly[(i + 1) % poly.length]);
  }
  let inner = '', outer = '';
  for (const [k, n] of segs) {
    const [a, b] = k.split('|').map((t) => t.split(',').map(Number));
    const d = `M${fmt(a[0])} ${fmt(a[1])}L${fmt(b[0])} ${fmt(b[1])}`;
    if (n === 1) outer += d; else inner += d;
  }
  grid += `<path d="${inner}" stroke="#b0b0b0" stroke-width="1" fill="none"/>`;
  grid += `<path d="${outer}" stroke="${INK}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
  return `<g stroke="none">${fills}</g>${grid}`;
}
function foldLineAndArrow(st, ox, oy, s) {
  let line;
  const { bb } = st;
  const ext = 0.35 * s;
  if (st.t === 'v') {
    const x = ox + st.k * s;
    line = [[x, oy + bb.r0 * s - ext], [x, oy + (bb.r1 + 1) * s + ext]];
  } else if (st.t === 'h') {
    const y = oy + st.k * s;
    line = [[ox + bb.c0 * s - ext, y], [ox + (bb.c1 + 1) * s + ext, y]];
  } else if (st.d === '\\') {
    line = [[ox + bb.c0 * s - ext * 0.7, oy + bb.r0 * s - ext * 0.7], [ox + (bb.c1 + 1) * s + ext * 0.7, oy + (bb.r1 + 1) * s + ext * 0.7]];
  } else {
    line = [[ox + (bb.c1 + 1) * s + ext * 0.7, oy + bb.r0 * s - ext * 0.7], [ox + bb.c0 * s - ext * 0.7, oy + (bb.r1 + 1) * s + ext * 0.7]];
  }
  let out = `<line x1="${fmt(line[0][0])}" y1="${fmt(line[0][1])}" x2="${fmt(line[1][0])}" y2="${fmt(line[1][1])}" stroke="${INK}" stroke-width="1.8" stroke-dasharray="5 3.5"/>`;
  // 화살표 : 세로 접기는 종이 위쪽 바깥에서, 가로 접기는 종이 오른쪽 바깥에서 접는 선을 넘어가는 곡선으로 그린다.
  const cen = (set) => { const ps = [...set].map(pu); return [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length]; };
  const a = cen(st.A), b = cen(st.fA);
  let A, B, C;
  const minHalf = 0.8 * s;
  if (st.t === 'v') {
    const y0 = oy + bb.r0 * s - 0.3 * s;
    let xa = ox + (a[0] + 0.5) * s, xb = ox + (b[0] + 0.5) * s;
    const mid = ox + st.k * s, dir = Math.sign(xb - xa);
    if (Math.abs(xa - mid) < minHalf) xa = mid - dir * minHalf;
    if (Math.abs(xb - mid) < minHalf) xb = mid + dir * minHalf;
    A = [xa, y0]; B = [xb, y0]; C = [mid, y0 - Math.max(0.9 * s, 0.32 * Math.abs(xb - xa))];
  } else if (st.t === 'h') {
    const x0 = ox + (bb.c1 + 1) * s + 0.3 * s;
    let ya = oy + (a[1] + 0.5) * s, yb = oy + (b[1] + 0.5) * s;
    const mid = oy + st.k * s, dir = Math.sign(yb - ya);
    if (Math.abs(ya - mid) < minHalf) ya = mid - dir * minHalf;
    if (Math.abs(yb - mid) < minHalf) yb = mid + dir * minHalf;
    A = [x0, ya]; B = [x0, yb]; C = [x0 + Math.max(0.9 * s, 0.32 * Math.abs(yb - ya)), mid];
  } else {
    // 대각선 접기 : 대각선에서 가장 먼 칸에서 출발해 대칭 위치로, 대각선 바깥쪽(모서리 쪽)으로 휘게
    const n = bb.c1 - bb.c0 + 1;
    const dist = ([c, r]) => (st.d === '\\' ? Math.abs((c - bb.c0) - (r - bb.r0)) : Math.abs((c - bb.c0) + (r - bb.r0) - (n - 1)));
    const far = [...st.A].map(pu).sort((p, q) => dist(q) - dist(p))[0];
    const tb = st.f(far);
    A = [ox + (far[0] + 0.5) * s, oy + (far[1] + 0.5) * s]; B = [ox + (tb[0] + 0.5) * s, oy + (tb[1] + 0.5) * s];
    const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = (B[1] - A[1]) / L, ny = -(B[0] - A[0]) / L; // 진행 방향의 수직
    C = [M[0] + nx * 0.35 * L, M[1] + ny * 0.35 * L];
  }
  const sh = 0.04;
  const A2 = [A[0] + (C[0] - A[0]) * sh, A[1] + (C[1] - A[1]) * sh], B2 = [B[0] + (C[0] - B[0]) * sh, B[1] + (C[1] - B[1]) * sh];
  out += `<path d="M${fmt(A2[0])} ${fmt(A2[1])}Q${fmt(C[0])} ${fmt(C[1])} ${fmt(B2[0])} ${fmt(B2[1])}" fill="none" stroke="${INK}" stroke-width="1.7"/>`;
  out += arrowHead(B2, C, 8);
  return out;
}
function paperFigureSVG(steps, snaps, holes) {
  const s = 19, pad = 12, gapArrow = 34, panel = 4 * s;
  const topM = 1.5 * s, rightM = 1.5 * s; // 접는 화살표가 들어갈 여백
  const pw = panel + rightM;
  const n = snaps.length;
  let body = '';
  for (let i = 0; i < n; i++) {
    const ox = pad + i * (pw + gapArrow), oy = pad + topM;
    body += paperStateBody(snaps[i], ox, oy, s);
    if (i < steps.length) body += foldLineAndArrow(steps[i], ox, oy, s);
    else for (const [c, r] of holes) body += `<circle cx="${fmt(ox + (c + 0.5) * s)}" cy="${fmt(oy + (r + 0.5) * s)}" r="${fmt(s * 0.24)}" fill="${INK}"/>`;
    if (i < n - 1) {
      const ax = ox + pw + gapArrow * 0.12, bx = ox + pw + gapArrow * 0.82, ay = oy + panel / 2;
      body += `<line x1="${fmt(ax)}" y1="${fmt(ay)}" x2="${fmt(bx - 5)}" y2="${fmt(ay)}" stroke="#777" stroke-width="2"/>` + arrowHead([bx, ay], [ax, ay], 8, '#777');
    }
    const label = i < steps.length ? `${i + 1}번째 접기` : '구멍 뚫기';
    body += svgText(ox + panel / 2, oy + panel + 0.6 * s + 14, label, { size: 12 });
  }
  const W = 2 * pad + n * pw + (n - 1) * gapArrow - rightM * 0.6, H = pad + topM + panel + 0.6 * s + 22 + pad - 4;
  return svgDoc(W, H, body, '종이 접기 순서와 구멍 위치');
}
function paperChoiceSVG(holeSet, label) {
  const s = 24, pad = 10;
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) cells.push({ c, r, layers: 1, tri: null });
  let body = paperStateBody(cells, pad, pad, s);
  for (const k of [...holeSet].sort()) {
    const [c, r] = pu(k);
    body += `<circle cx="${fmt(pad + (c + 0.5) * s)}" cy="${fmt(pad + (r + 0.5) * s)}" r="${fmt(s * 0.24)}" fill="${INK}"/>`;
  }
  return svgDoc(4 * s + 2 * pad, 4 * s + 2 * pad, body, label);
}
function buildPaper(ctx, no, cfg, ansPos) {
  const { steps, final } = planFolds(cfg.plan);
  const fw = paperForward(cfg.plan, steps);
  const lastDiag = steps[steps.length - 1].t === 'd' ? steps[steps.length - 1] : null;
  const punchable = [...final].map(pu).filter((p) => !(lastDiag && lastDiag.onDiag(p)));
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = ctx.rng('paper', no, attempt);
    const holes = rng.shuffle(punchable).slice(0, cfg.holes).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const right = unfold(steps, holes);
    // 순방향(층 추적) 결과와 역방향(펼치기) 결과가 같은지 확인
    const fwdSet = new Set(fw.layers.filter((L) => holes.some((h) => h[0] === L.pos[0] && h[1] === L.pos[1])).map((L) => pk(...L.orig)));
    assert(holeKey(fwdSet) === holeKey(right.set), `${ctx.id(no)} 종이접기 순방향/역방향 불일치`);
    const total = right.set.size;
    if (total < cfg.minHoles || total > cfg.maxHoles) continue;
    const cands = [];
    const nSteps = steps.length;
    const errName = { translate: '접는 선에 대해 대칭이 아니라 그대로 평행이동해서 펼친', skip: '펼칠 때 겹쳐 있던 쪽의 구멍을 빠뜨린', otherDiag: '반대쪽 대각선을 기준으로 펼친' };
    for (let i = 0; i < nSteps; i++) {
      const kinds = steps[i].t === 'd' ? ['otherDiag', 'skip'] : ['translate', 'skip'];
      for (const e of kinds) cands.push({ v: unfold(steps, holes, { [i]: e }).set, why: `${i + 1}번째 접기를 ${errName[e]} 모양`, kind: e });
      for (let k = i + 1; k < nSteps; k++) {
        const kinds2 = steps[k].t === 'd' ? ['otherDiag'] : ['translate'];
        for (const e of kinds.filter((x) => x !== 'skip')) for (const e2 of kinds2) {
          cands.push({ v: unfold(steps, holes, { [i]: e, [k]: e2 }).set, why: `${i + 1}번째와 ${k + 1}번째 접기를 모두 잘못 펼친 모양(대칭이 아닌 평행이동 등)`, kind: 'double' });
        }
      }
    }
    const glob = (fn) => new Set([...right.set].map((p) => pk(...fn(pu(p)))));
    cands.push({ v: glob(([c, r]) => [3 - c, r]), why: '정답을 좌우로 뒤집은 모양', kind: 'mirror' });
    cands.push({ v: glob(([c, r]) => [c, 3 - r]), why: '정답을 위아래로 뒤집은 모양', kind: 'mirror' });
    cands.push({ v: glob(([c, r]) => [3 - r, c]), why: '정답을 90° 돌린 모양', kind: 'rot' });
    const keys = new Set([holeKey(right.set)]);
    const pool = [];
    const order = [...rng.shuffle(cands.filter((c) => c.kind === 'translate' || c.kind === 'otherDiag')),
      ...rng.shuffle(cands.filter((c) => c.kind === 'double')),
      ...rng.shuffle(cands.filter((c) => c.kind === 'skip')).slice(0, 1),
      ...rng.shuffle(cands.filter((c) => c.kind === 'mirror' || c.kind === 'rot'))];
    for (const c of order) {
      if (c.v.size === 0 || keys.has(holeKey(c.v))) continue;
      if (c.kind !== 'skip' && Math.abs(c.v.size - total) > 1) continue;
      keys.add(holeKey(c.v)); pool.push(c);
    }
    // 오답 4개 : 한 번의 접기를 잘못 펼친 오답을 적어도 하나 넣고, 정답이 선지 집합의 중심(구멍 위치 차이 합 최소)이 아니며
    // 칸별 다수결 조합이 정답과 다르게 고른다. 앞에서부터 고른 조합이 조건을 채우면 그대로 쓰고, 아니면 무작위로 다시 고른다.
    const okPick = (ps) => ps.length === 4 && ps.some((c) => c.kind === 'translate' || c.kind === 'otherDiag')
      && notCenter(centerStats([right.set, ...ps.map((c) => c.v)], 0, holeDist)) && notOutlier(centerStats([right.set, ...ps.map((c) => c.v)], 0, holeDist))
      && majorityLost([right.set, ...ps.map((c) => c.v)], 0, paperSlots).length > 0;
    let pickedList = pool.slice(0, 4);
    for (let t = 0; t < 2000 && !okPick(pickedList); t++) pickedList = sampleK(rng, pool, 4) || [];
    if (!okPick(pickedList)) continue;
    const { list, meta } = placeChoices(right.set, rng.shuffle(pickedList), ansPos);
    assert(new Set(list.map(holeKey)).size === 5, `${ctx.id(no)} 종이접기 선지 중복`);
    assert(list.filter((x) => holeKey(x) === holeKey(right.set)).length === 1, `${ctx.id(no)} 종이접기 정답 유일성`);
    const st = centerStats(list, ansPos - 1, holeDist);
    assert(notCenter(st) && notOutlier(st), `${ctx.id(no)} 정답이 선지 집합의 중심이거나 혼자 동떨어짐(차이 합 ${st.sums.join(',')})`);
    assert(majorityLost(list, ansPos - 1, paperSlots).length > 0, `${ctx.id(no)} 칸별 다수결 조합이 정답과 같음`);
    ctx.metric(no, '종이 접기', '구멍 위치 차이', st);
    const seq = right.counts.join('개 → ') + '개';
    const wrongs = meta.map((m, i) => (m ? `${j(CIRC[i], '은/는')} ${m.why}이다.` : null)).filter(Boolean);
    ctx.log(no, `접기 ${nSteps}회, 구멍 ${holes.length}개 → 펼치면 ${total}개, 순방향=역방향 일치, 오답 [${pickedList.map((c) => c.kind).join(',')}], 차이 합 ${st.sums.join('/')}`);
    return {
      subtype: '종이 접기',
      stem: '다음과 같이 종이를 접은 뒤 구멍을 뚫고 다시 펼쳤을 때의 모양으로 옳은 것은?',
      figure: { svg: paperFigureSVG(steps, fw.snaps, holes), caption: '점선은 접는 선, 화살표는 접는 방향이다. 회색이 진할수록 여러 겹이다.' },
      choiceSvgs: list.map((x, i) => paperChoiceSVG(x, `${CIRC[i]} 펼친 종이`)),
      answer: ansPos,
      explanation: `정답 ${CIRC[ansPos - 1]}: 접은 순서의 역순으로 펼치면서, 접힌 부분에 뚫린 구멍을 그때의 접는 선에 대해 선대칭으로 옮긴다. 구멍 수는 ${seq}가 된다(겹친 장수만큼 늘어남).<br>` + wrongs.join('<br>'),
    };
  }
  throw new Error(`${ctx.id(no)} 종이 접기 생성 실패`);
}

// ───────────────────── 5) 블록 개수 ─────────────────────
// 등각투상 그림에서 면이 하나도 보이지 않는(완전히 가려진) 블록 수를 층별로 센다. hz[z] = (z+1)층의 가려진 블록 수
function hiddenByLayer(h) {
  const R = renderTris(h);
  const visIdx = new Set(R.owner.values());
  const seen = new Set();
  R.faces.forEach((f, i) => { if (visIdx.has(i)) seen.add(`${f.x},${f.y},${f.z}`); });
  const hz = new Array(hmMax(h)).fill(0);
  h.forEach((r, y) => r.forEach((v, x) => { for (let z = 0; z < v; z++) if (!seen.has(`${x},${y},${z}`)) hz[z]++; }));
  return hz;
}
function buildCount(ctx, no, cfg, ansPos) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = ctx.rng('count', no, attempt);
    let h;
    // 개수 세기 문항은 모든 열의 윗면이 온전히 보이고, 빈칸은 바닥이 온전히 보이는 더미만 쓴다.
    // (열마다 높이를 읽을 수 있고, 빈칸을 '보이지 않는 곳'으로 오해해 채워 세지 않게)
    const read = { fullTops: true, fullFloor: true };
    try { h = genHeightmap(rng, { ...cfg, minLevels: 3, read }); } catch (e) { if (e instanceof GenError) continue; throw e; }
    const N = hmCount(h);
    const maxH = hmMax(h), X = h[0].length, Y = h.length;
    const levels = [];
    for (let z = 1; z <= maxH; z++) levels.push(h.flat().filter((v) => v >= z).length);
    assert(levels.reduce((a, b) => a + b, 0) === N, '층별 합계');
    const vis = checkVisibility(h, read);
    assert(vis.ok, `${ctx.id(no)} 블록 더미 가시성`);
    const holes = h.flat().filter((v) => v === 0).length;
    const grid = h.map((r) => r.join('·')).join(' / ');
    const gridTxt = `칸마다 높이를 앞줄부터 왼쪽→오른쪽 순서로 적으면 ${grid}이고, 모두 더해도 ${N}개이다${holes ? `(0은 바닥판이 그대로 드러난 빈칸 ${holes}개로, 가려진 곳이 아니라 비어 있는 칸이다)` : ''}.`;
    const value = cfg.mode === 'cuboid' ? X * Y * maxH - N : N;
    if (value < 5) continue;
    // 숫자 선지는 관례대로 오름차순이다. 정답 위치는 회차의 정답 번호 계획(ansPos)을 따르고, 오답은 실제로 나올 법한
    // 잘못 센 값(가려진 블록 누락, 모서리 기둥 중복 계산, 빈칸 채움 등)으로 정답 아래에 ansPos−1개, 위에 5−ansPos개를 둔다.
    const hz = hiddenByLayer(h);
    const H0 = hz.reduce((a, b) => a + b, 0);
    const hzTxt = hz.map((n, z) => (n ? `${z + 1}층 ${n}개` : null)).filter(Boolean).join(', ');
    const corner = h[0][X - 1];
    const mis = []; // { v, why }
    if (cfg.mode === 'cuboid') {
      mis.push({ v: N, why: `더 필요한 블록 수가 아니라 지금 있는 블록 수(${N}개)를 답한 값` });
      if (H0) mis.push({ v: value + H0, why: `지금 있는 블록을 셀 때 면이 하나도 보이지 않는 블록 ${H0}개(${hzTxt})를 빠뜨려, 그만큼 더 필요하다고 본 값` });
      hz.forEach((n, z) => { if (n && n !== H0) mis.push({ v: value + n, why: `지금 있는 블록을 셀 때 ${z + 1}층에서 다른 블록에 가려 그림에 보이지 않는 블록 ${n}개를 빠뜨려, 그만큼 더 필요하다고 본 값` }); });
      if (corner) mis.push({ v: value - corner, why: `지금 있는 블록을 셀 때 정면과 우측면이 함께 보이는 앞쪽 오른쪽 모서리 기둥의 블록 ${corner}개를 두 번 세어, 그만큼 덜 필요하다고 본 값` });
      for (const k of [1, 2, 3]) {
        mis.push({ v: value + k, why: `지금 있는 블록을 셀 때 가려진 블록 ${k}개를 빠뜨려, 그만큼 더 필요하다고 본 값` });
        mis.push({ v: value - k, why: `지금 있는 블록을 셀 때 블록 ${k}개를 두 번 세어, 그만큼 덜 필요하다고 본 값` });
      }
    } else {
      if (H0) mis.push({ v: N - H0, why: `그림에서 면이 하나도 보이지 않는 블록 ${H0}개(${hzTxt})를 모두 빠뜨리고 보이는 블록만 센 값` });
      hz.forEach((n, z) => { if (n && n !== H0) mis.push({ v: N - n, why: `${z + 1}층에서 다른 블록에 가려 그림에 보이지 않는 블록 ${n}개를 빠뜨린 값` }); });
      if (holes) mis.push({ v: N + holes, why: `바닥판이 드러난 빈칸 ${holes}개에도 블록이 1개씩 있다고 본 값` });
      if (corner) mis.push({ v: N + corner, why: `정면과 우측면이 함께 보이는 앞쪽 오른쪽 모서리 기둥의 블록 ${corner}개를 앞줄과 오른쪽 줄에서 두 번 센 값` });
      for (const k of [1, 2, 3]) {
        mis.push({ v: N - k, why: `가려진 블록 ${k}개를 빠뜨린 값` });
        mis.push({ v: N + k, why: `블록 ${k}개를 두 번 센 값` });
      }
    }
    const below = [], above = [];
    for (const m of mis) {
      if (m.v <= 0 || m.v === value || Math.abs(m.v - value) > 7) continue; // 너무 동떨어진 값은 오답으로 그럴듯하지 않다
      const side = m.v < value ? below : above;
      if (below.concat(above).some((o) => o.v === m.v)) continue; // 같은 값은 먼저 나온(더 구체적인) 이유만 쓴다
      side.push(m);
    }
    const nb = ansPos - 1, na = 5 - ansPos;
    if (below.length < nb || above.length < na) continue;
    const picked = [...below.slice(0, nb), { v: value, why: null }, ...above.slice(0, na)].sort((a, b) => a.v - b.v);
    const nums = picked.map((m) => m.v);
    assert(nums[ansPos - 1] === value && nums.every((v) => v > 0), `${ctx.id(no)} 숫자 선지`);
    assert(nums.every((v, k) => k === 0 || v > nums[k - 1]), `${ctx.id(no)} 숫자 선지 오름차순`);
    const misTxt = picked.map((m, i) => (m.why ? `${CIRC[i]} ${m.v}개는 ${m.why}이다.` : null)).filter(Boolean).join('<br>');
    const lv = levels.map((n, i) => `${i + 1}층 ${n}개`).join(' + ');
    const st = centerStats(nums, ansPos - 1, (a, b) => Math.abs(a - b));
    ctx.metric(no, '블록 개수', '값 차이(참고)', st, `선지 ${nums.join('·')}, 정답 ${CIRC[ansPos - 1]}`);
    ctx.log(no, `${cfg.mode === 'cuboid' ? '직육면체 완성' : '개수 세기'}: ${X}×${Y}×${maxH}, 블록 ${N}개(빈칸 ${holes}개, 바닥 모두 보임, 완전히 가려진 블록 ${H0}개) → 정답 ${value}, 선지 ${nums.join('·')}(정답 ${CIRC[ansPos - 1]}), 가시성 검사(대안 ${vis.tested}가지) 통과`);
    ctx.counts.push({ id: ctx.id(no), mode: cfg.mode, nums, ansPos });
    if (cfg.mode === 'cuboid') {
      return {
        _debug: { figure: h },
        subtype: '블록 개수',
        stem: '다음 블록 더미에 블록을 더 쌓아 직육면체를 만들려고 한다. 최소 몇 개의 블록이 더 필요한가? (단, 보이지 않는 곳에 빈 공간은 없으며 모든 블록은 바닥부터 쌓여 있다)',
        figure: { svg: isoSVGs([h], 28, { arrow: false }, ['블록 더미'])[0], caption: '' },
        choices: nums.map((v) => `${v}개`),
        answer: ansPos,
        explanation: `정답 ${CIRC[ansPos - 1]}: 가장 작은 직육면체는 가로 ${X}칸 × 세로 ${Y}칸 × 높이 ${maxH}층이므로 ${X * Y * maxH}개가 필요하다. 지금 있는 블록은 층별로 세면 ${lv} = ${N}개이므로 ${X * Y * maxH} − ${N} = ${value}개가 더 필요하다.<br>${gridTxt}<br>${misTxt}`,
      };
    }
    return {
      _debug: { figure: h },
      subtype: '블록 개수',
      stem: '다음 블록 더미에 사용된 블록의 개수는? (단, 보이지 않는 곳에 빈 공간은 없으며 모든 블록은 바닥부터 쌓여 있다)',
      figure: { svg: isoSVGs([h], 28, { arrow: false }, ['블록 더미'])[0], caption: '' },
      choices: nums.map((v) => `${v}개`),
      answer: ansPos,
      explanation: `정답 ${CIRC[ansPos - 1]}: 층별로 센다. 바닥(1층)에는 블록이 놓인 칸 수만큼, 2층 이상에는 그 높이 이상인 칸 수만큼 있다. ${lv} = ${N}개.<br>위에서 본 칸마다 높이를 적어 더해도 된다. ${gridTxt}<br>${misTxt}`,
    };
  }
  throw new Error(`${ctx.id(no)} 블록 개수 생성 실패`);
}

// ───────────────────────────── 회차 구성 ─────────────────────────────
const SET_PLANS = {
  1: {
    v2s: [
      { X: 3, Y: 3, maxH: 2, minCount: 7, maxCount: 11, dCount: 2 },
      { X: 3, Y: 3, maxH: 3, minCount: 9, maxCount: 14, dCount: 2 },
      { X: 4, Y: 3, maxH: 3, minCount: 12, maxCount: 18, dCount: 2, hard: true },
      { X: 4, Y: 4, maxH: 3, minCount: 16, maxCount: 24, dCount: 2, hard: true },
    ],
    s2v: [
      { X: 4, Y: 3, maxH: 3, minCount: 11, maxCount: 18, view: 'front' },
      { X: 4, Y: 4, maxH: 3, minCount: 15, maxCount: 24, view: 'right', hard: true },
    ],
    net: [{ net: 2, mode: 'can' }, { net: 7, mode: 'cannot', hard: true }],
    paper: { plan: [{ t: 'v', k: 2, flap: 'L' }, { t: 'h', k: 1, flap: 'T' }], holes: 2, minHoles: 5, maxHoles: 6 },
    count: { X: 4, Y: 3, maxH: 3, minCount: 15, maxCount: 22, mode: 'count', ansPos: 4 },
  },
  2: {
    v2s: [
      { X: 3, Y: 3, maxH: 3, minCount: 8, maxCount: 12, dCount: 2 },
      { X: 3, Y: 4, maxH: 3, minCount: 10, maxCount: 16, dCount: 2 },
      { X: 4, Y: 3, maxH: 3, minCount: 12, maxCount: 19, dCount: 2, hard: true },
      { X: 4, Y: 3, maxH: 4, minCount: 15, maxCount: 24, dCount: 2, hard: true },
    ],
    s2v: [
      { X: 4, Y: 3, maxH: 3, minCount: 10, maxCount: 18, view: 'top' },
      { X: 4, Y: 3, maxH: 4, minCount: 14, maxCount: 24, view: 'front', hard: true },
    ],
    net: [{ net: 5, mode: 'can' }, { net: 9, mode: 'cannot', hard: true }],
    paper: { plan: [{ t: 'v', k: 1, flap: 'L' }, { t: 'h', k: 1, flap: 'T' }, { t: 'd', d: '\\', flap: 'U' }], holes: 2, minHoles: 6, maxHoles: 8 },
    count: { X: 3, Y: 4, maxH: 3, minCount: 13, maxCount: 20, mode: 'cuboid', ansPos: 2 },
  },
  3: {
    v2s: [
      { X: 3, Y: 3, maxH: 3, minCount: 9, maxCount: 13, dCount: 2 },
      { X: 4, Y: 3, maxH: 3, minCount: 11, maxCount: 17, dCount: 2 },
      { X: 3, Y: 4, maxH: 4, minCount: 14, maxCount: 22, dCount: 2, hard: true },
      { X: 4, Y: 4, maxH: 3, minCount: 17, maxCount: 26, dCount: 2, hard: true },
    ],
    s2v: [
      { X: 4, Y: 3, maxH: 3, minCount: 11, maxCount: 18, view: 'right' },
      { X: 4, Y: 4, maxH: 3, minCount: 15, maxCount: 26, view: 'top', hard: true },
    ],
    net: [{ net: 1, mode: 'can' }, { net: 10, mode: 'cannot', hard: true }],
    paper: { plan: [{ t: 'v', k: 1, flap: 'L' }, { t: 'h', k: 2, flap: 'B' }, { t: 'v', k: 2, flap: 'L' }], holes: 2, minHoles: 6, maxHoles: 8 },
    count: { X: 4, Y: 4, maxH: 3, minCount: 20, maxCount: 30, mode: 'count', ansPos: 5 },
  },
};

// 회차의 정답 번호 계획 : 번호마다 2개씩, 같은 번호가 3번 연달아 나오지 않게 섞는다.
// 블록 개수(숫자 선지) 문항도 계획대로 정답 위치를 정한다(늘 가운데 ③에 두면 '가운데 값 고르기'가 통한다).
const run3 = (arr) => arr.some((v, i) => i >= 2 && v === arr[i - 1] && v === arr[i - 2]);
function balancedAnswers(rng, n) {
  const base = [];
  for (let i = 0; i < n; i++) base.push((i % 5) + 1);
  for (let t = 0; t < 1000; t++) {
    const a = rng.shuffle(base);
    if (!run3(a)) return a;
  }
  throw new Error('정답 번호 계획 실패');
}
// 블록 개수(숫자 선지) 문항의 정답 위치는 회차마다 다르게 미리 정한다(1회 ④, 2회 ②, 3회 ⑤).
// 세 문항을 모아 보면 '가운데 값 고르기', '개수는 가장 큰 값·직육면체 채우기는 가장 작은 값 고르기(적게 세는 실수가 흔하다는 점을 노림)',
// '양 끝 값 고르기' 가운데 어느 것도 우연(3문항 중 0.6~1.2개)보다 많이 맞지 않는다.
// 계획에서 그 문항의 번호를 원하는 번호와 맞바꾼다(뒤쪽 문항부터 찾고, 같은 번호 3연속이 생기는 자리는 피한다). 회차 분포는 그대로다.
function placeAnswer(answers, idx, want) {
  if (!want || answers[idx] === want) return answers;
  for (let k = answers.length - 1; k >= 0; k--) {
    if (k === idx || answers[k] !== want) continue;
    const b = answers.slice(); [b[idx], b[k]] = [b[k], b[idx]];
    if (!run3(b)) return b;
  }
  throw new Error('정답 위치 조정 실패');
}

function buildSet(setNo) {
  const plan = SET_PLANS[setNo];
  const logs = [];
  const ctx = {
    rng: (...parts) => new Rng(hashSeed(SEEDS[setNo], ...parts)),
    id: (no) => `S${setNo}-SP-${String(no).padStart(2, '0')}`,
    log: (no, msg) => logs.push(`  ${ctx.id(no)} ${msg}`),
    metrics: [],
    metric: (no, type, measure, st, extra = '', { tieOk = false } = {}) => ctx.metrics.push({ id: ctx.id(no), type, measure, ans: st.ans, minOther: st.minOther, maxOther: st.maxOther, rank: st.rank, sums: st.sums, extra, tieOk }),
    counts: [],
    usedTops: new Set(),
  };
  const answers = placeAnswer(balancedAnswers(new Rng(hashSeed(SEEDS[setNo], 'answers')), 10), 9, plan.count.ansPos);
  const raw = [];
  plan.v2s.forEach((cfg, i) => raw.push(buildViewsToSolid(ctx, i + 1, cfg, answers[i])));
  plan.s2v.forEach((cfg, i) => raw.push(buildSolidToView(ctx, 5 + i, cfg, answers[4 + i])));
  plan.net.forEach((cfg, i) => raw.push(buildNet(ctx, 7 + i, cfg, answers[6 + i])));
  raw.push(buildPaper(ctx, 9, plan.paper, answers[8]));
  raw.push(buildCount(ctx, 10, plan.count, answers[9]));
  const debug = raw.map((it, i) => ({ id: ctx.id(i + 1), ...(it._debug || {}) }));
  const items = raw.map((it, i) => { const { _debug, ...rest } = it; return { id: ctx.id(i + 1), ...rest }; });
  return { items, logs, answers, debug, metrics: ctx.metrics, counts: ctx.counts };
}

// ───────────────────────────── 최종 검증 ─────────────────────────────
function validateItems(setNo, items) {
  assert(items.length === 10, `set${setNo} 문항 수`);
  const dist = [0, 0, 0, 0, 0];
  items.forEach((it, i) => {
    assert(it.id === `S${setNo}-SP-${String(i + 1).padStart(2, '0')}`, `${it.id} id`);
    assert(Number.isInteger(it.answer) && it.answer >= 1 && it.answer <= 5, `${it.id} answer`);
    dist[it.answer - 1]++;
    assert(typeof it.explanation === 'string' && it.explanation.length > 40, `${it.id} explanation`);
    assert(it.stem && it.subtype, `${it.id} stem/subtype`);
    const svgs = [];
    if (it.figure) svgs.push(it.figure.svg);
    if (it.choiceSvgs) { assert(it.choiceSvgs.length === 5 && !it.choices, `${it.id} choiceSvgs`); svgs.push(...it.choiceSvgs); assert(new Set(it.choiceSvgs).size === 5, `${it.id} 선지 그림 중복`); }
    else {
      assert(Array.isArray(it.choices) && it.choices.length === 5 && new Set(it.choices).size === 5, `${it.id} choices`);
      const ns = it.choices.map((c) => parseInt(c, 10));
      if (ns.every(Number.isFinite)) {
        assert(ns.every((v, k) => k === 0 || v > ns[k - 1]), `${it.id} 숫자 선지 오름차순`);
      }
    }
    for (const s of svgs) {
      assert(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="'), `${it.id} svg 머리`);
      const head = s.slice(0, s.indexOf('>'));
      assert(!/\swidth=|\sheight=/.test(head), `${it.id} 루트 svg에 width/height 금지`);
      assert(s.includes('fill="#fff"/>'), `${it.id} 흰 배경`);
      assert((s.match(/<svg/g) || []).length === 1 && s.endsWith('</svg>'), `${it.id} svg 구조`);
      const texts = s.match(/<text [^>]*>/g) || [];
      texts.forEach((t) => assert(t.includes(`font-family="${FONT}"`), `${it.id} 글꼴`));
    }
  });
  dist.forEach((n) => assert(n === 2, `set${setNo} 정답 분포 ${dist.join(',')}`));
  assert(!run3(items.map((it) => it.answer)), `set${setNo} 같은 정답 번호 3연속`);
  return dist;
}

function main() {
  const t0 = Date.now();
  console.log('공간지각 문항 생성 (tools/gen-spatial.mjs)');
  const debugAll = {};
  const metricsAll = [], countsAll = [];
  for (const setNo of [1, 2, 3]) {
    const { items, logs, debug, metrics, counts } = buildSet(setNo);
    debugAll[setNo] = debug;
    metricsAll.push(...metrics); countsAll.push(...counts);
    const dist = validateItems(setNo, items);
    const file = path.join(OUT_DIR, `set${setNo}-spatial.js`);
    const header = `/* 자동 생성 파일: tools/gen-spatial.mjs (seed 0x${SEEDS[setNo].toString(16)}). 직접 고치지 말고 생성기를 다시 실행할 것. 공간지각 ${items.length}문항. */`;
    fs.writeFileSync(file, `${header}\nHMAT.add(${setNo}, 'spatial', ${JSON.stringify(items, null, 2)});\n`);
    console.log(`\n[set${setNo}] → ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
    logs.forEach((l) => console.log(l));
    console.log(`  정답 분포 ①~⑤: ${dist.join(' / ')} | 정답 순서: ${items.map((it) => CIRC[it.answer - 1]).join('')}`);
  }
  // 찍기 단서 점검 요약 : 정답의 차이 합과 가장 작은 오답의 차이 합(정답 > 최소 오답이어야 함). 블록 개수는 참고용.
  console.log('\n선지 집합 중심 점검 (정답 차이 합 / 가장 작은 오답 차이 합, 정답 순위)');
  for (const m of metricsAll) {
    if (m.type !== '블록 개수') {
      assert(m.tieOk ? m.minOther <= m.ans : m.minOther < m.ans, `${m.id} 정답이 선지 집합의 중심`);
      assert(m.tieOk ? m.maxOther >= m.ans : m.maxOther > m.ans, `${m.id} 정답이 가장 동떨어진 선지`);
    }
    console.log(`  ${m.id} ${m.type.padEnd(14)} ${m.measure}: 정답 ${m.ans} / 최소 오답 ${m.minOther} (정답 순위 ${m.rank}/5, 전체 ${m.sums.join('·')})${m.extra ? ' ' + m.extra : ''}`);
  }
  // 블록 개수 문항의 정답 위치가 회차마다 달라야 한다
  assert(new Set(countsAll.map((c) => c.ansPos)).size === countsAll.length, `블록 개수 문항 정답 위치가 회차끼리 겹침 ${countsAll.map((c) => c.ansPos).join(',')}`);
  // 선택: 높이맵 등 내부 구조를 JSON으로 내보내 미리보기 검수에 쓴다(데이터 파일에는 들어가지 않는다)
  if (process.env.SPATIAL_DEBUG_OUT) fs.writeFileSync(process.env.SPATIAL_DEBUG_OUT, JSON.stringify(debugAll));
  console.log(`\n모든 검증 통과 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main();
