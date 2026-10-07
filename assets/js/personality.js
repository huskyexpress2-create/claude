/* 인성검사: 회차별 문항 구성(시드 고정) + 참고 지표 산출 */
(function (g) {
  var DIMS = ['C', 'E', 'N', 'O', 'A', 'I'];
  var DIM_NAMES = { C: '성실·계획성', E: '외향·주도성', N: '정서안정성', O: '개방·도전성', A: '협력·친화성', I: '윤리·책임성' };
  var PART1_BLOCKS = 52;   // 3진술 × 52묶음 = 156진술 (보고치 155 근사)
  var PART2_TOTAL = 300;
  var LIE_COUNT = 15;
  var PAIR_COUNT = 40;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function bankMap() {
    var m = {};
    (g.HMAT && g.HMAT.personalityBank || []).forEach(function (s) { m[s.id] = s; });
    return m;
  }

  function build(setNo) {
    var bank = (g.HMAT && g.HMAT.personalityBank) || [];
    var rnd = mulberry32(setNo * 104729 + 17);
    var regular = bank.filter(function (s) { return !s.lie && DIMS.indexOf(s.dim) >= 0; });
    var lies = shuffle(bank.filter(function (s) { return s.lie; }), rnd).slice(0, LIE_COUNT);

    var pairMap = {};
    regular.forEach(function (s) { if (s.pair) (pairMap[s.pair] = pairMap[s.pair] || []).push(s); });
    var pairIds = Object.keys(pairMap).filter(function (k) { return pairMap[k].length === 2; }).sort();
    shuffle(pairIds, rnd);
    var chosen = pairIds.slice(0, Math.min(PAIR_COUNT, pairIds.length));

    var perDim = Math.floor(PART1_BLOCKS * 3 / DIMS.length);
    var need1 = {}; DIMS.forEach(function (d) { need1[d] = perDim; });
    var p1 = [], p2 = [];
    chosen.forEach(function (pid) {
      var pr = shuffle(pairMap[pid].slice(), rnd), a = pr[0], b = pr[1];
      if (rnd() < 0.5 && need1[a.dim] > 0) { p1.push(a); need1[a.dim]--; } else p2.push(a);
      p2.push(b);
    });

    var pool = {}; DIMS.forEach(function (d) { pool[d] = []; });
    regular.forEach(function (s) { if (!s.pair || !pairMap[s.pair] || pairMap[s.pair].length !== 2) pool[s.dim].push(s); });
    // 고르지 않은 쌍은 한쪽만 써서 중복 진술이 섞이지 않게 한다.
    pairIds.slice(chosen.length).forEach(function (pid) {
      var m = pairMap[pid][rnd() < 0.5 ? 0 : 1];
      pool[m.dim].push(m);
    });
    DIMS.forEach(function (d) { shuffle(pool[d], rnd); });
    DIMS.forEach(function (d) { while (need1[d] > 0 && pool[d].length) { p1.push(pool[d].pop()); need1[d]--; } });

    var byDim = {}; DIMS.forEach(function (d) { byDim[d] = shuffle(p1.filter(function (s) { return s.dim === d; }), rnd); });
    var blocks = [];
    while (blocks.length < PART1_BLOCKS) {
      var avail = DIMS.filter(function (d) { return byDim[d].length; });
      if (avail.length < 3) break;
      shuffle(avail, rnd);
      avail.sort(function (x, y) { return byDim[y].length - byDim[x].length; });
      blocks.push([byDim[avail[0]].pop(), byDim[avail[1]].pop(), byDim[avail[2]].pop()]);
    }
    DIMS.forEach(function (d) { byDim[d].forEach(function (s) { p2.push(s); }); });
    shuffle(blocks, rnd);
    blocks.forEach(function (b) { shuffle(b, rnd); });

    var target2 = PART2_TOTAL - lies.length, di = 0, guard = 0;
    while (p2.length < target2 && guard++ < 5000) {
      var d = DIMS[di++ % DIMS.length];
      if (pool[d].length) p2.push(pool[d].pop());
      else if (DIMS.every(function (x) { return !pool[x].length; })) break;
    }
    p2 = p2.slice(0, target2);
    shuffle(p2, rnd);
    lies.forEach(function (l, i) {
      var pos = Math.min(p2.length, Math.floor((i + 0.5) * (p2.length + i) / lies.length));
      p2.splice(pos, 0, l);
    });
    // 같은 쌍이 Ⅱ부에서 너무 가까이 붙지 않도록 떼어 놓는다(최소 40문항 간격).
    var idx = {};
    p2.forEach(function (s, i) { if (s.pair && chosen.indexOf(s.pair) >= 0) (idx[s.pair] = idx[s.pair] || []).push(i); });
    Object.keys(idx).forEach(function (pid) {
      var pos = idx[pid];
      if (pos.length !== 2 || Math.abs(pos[0] - pos[1]) >= 40) return;
      var from = pos[1], to = (pos[0] + 120 + Math.floor(rnd() * 60)) % p2.length;
      for (var k = 0; k < p2.length; k++) {
        var cand = (to + k) % p2.length;
        if (!p2[cand].pair && !p2[cand].lie && Math.abs(cand - pos[0]) >= 40) {
          var t = p2[cand]; p2[cand] = p2[from]; p2[from] = t; break;
        }
      }
    });

    return {
      blocks: blocks.map(function (b) { return b.map(function (s) { return s.id; }); }),
      items: p2.map(function (s) { return s.id; })
    };
  }

  /* 응답값을 0~1로 정규화: likertMax 척도(1..max) 또는 예/아니오(1/0) */
  function norm(v, max) {
    if (v == null) return null;
    if (max === 2) return v === 1 ? 1 : 0;
    return (v - 1) / (max - 1);
  }

  function score(sess) {
    var map = bankMap();
    var s = sess.settings;
    var max1 = s.likert, max2 = s.part2 === 'yn' ? 2 : (s.part2 === 'l4' ? 4 : 5);
    var ans = sess.answers || {};
    var dimSum = {}, dimN = {};
    DIMS.forEach(function (d) { dimSum[d] = 0; dimN[d] = 0; });
    var total = 0, answered = 0, extreme = 0, likertCount = 0;
    var part1Ids = [], part2Ids = sess.parts.items;
    sess.parts.blocks.forEach(function (b) { part1Ids = part1Ids.concat(b); });
    var normOf = {}, scaleOf = {};

    function take(id, max) {
      var st = map[id]; if (!st) return;
      total++;
      var v = ans[id];
      if (v == null) return;
      answered++;
      if (max > 2) { likertCount++; if (v === 1 || v === max) extreme++; }
      var n = norm(v, max);
      var keyed = st.key === -1 ? 1 - n : n;
      normOf[id] = keyed;
      scaleOf[id] = max;
      if (!st.lie && dimSum[st.dim] != null) { dimSum[st.dim] += keyed; dimN[st.dim]++; }
    }
    part1Ids.forEach(function (id) { take(id, max1); });
    part2Ids.forEach(function (id) { take(id, max2); });

    // 일관성: 같은 pair의 두 진술(키 방향 반영) 비교.
    // 두 진술의 척도가 같으면 정규화 값의 차이를, 다르면(Ⅰ부 리커트 ↔ Ⅱ부 예/아니오) 응답 방향만 비교한다.
    // 척도가 다른데 한쪽이 '보통이다'(중립)면 방향을 정할 수 없어 비교에서 뺀다.
    var pairs = {}, diffs = [], bigGaps = 0;
    part1Ids.concat(part2Ids).forEach(function (id) {
      var st = map[id]; if (st && st.pair) (pairs[st.pair] = pairs[st.pair] || []).push(id);
    });
    function dir(x) { return x > 0.5 ? 1 : x < 0.5 ? -1 : 0; }
    Object.keys(pairs).forEach(function (p) {
      var ids = pairs[p];
      if (ids.length !== 2 || normOf[ids[0]] == null || normOf[ids[1]] == null) return;
      var a = normOf[ids[0]], b = normOf[ids[1]];
      if (scaleOf[ids[0]] === scaleOf[ids[1]]) {
        var d = Math.abs(a - b);
        diffs.push(d);
        if (d >= 0.5) bigGaps++;
      } else {
        if (!dir(a) || !dir(b)) return;
        var opposite = dir(a) !== dir(b);
        diffs.push(opposite ? 1 : 0);
        if (opposite) bigGaps++;
      }
    });
    var consistency = diffs.length ? Math.round(100 * (1 - diffs.reduce(function (x, y) { return x + y; }, 0) / diffs.length)) : null;

    // 가/멀 선택과 척도 응답의 모순
    var fcConflict = 0, fcTotal = 0, fcMissing = 0, nearByDim = {};
    DIMS.forEach(function (d) { nearByDim[d] = 0; });
    sess.parts.blocks.forEach(function (b, bi) {
      var f = (sess.fc || {})[bi] || {};
      if (!f.near || !f.far) { fcMissing++; return; }
      fcTotal++;
      var vn = ans[f.near], vf = ans[f.far];
      if (vn != null && vf != null && vn < vf) fcConflict++;
      var st = map[f.near];
      if (st && nearByDim[st.dim] != null) nearByDim[st.dim] += st.key === -1 ? -1 : 1;
    });

    // 바람직성(과장) 문항
    var lieIds = part2Ids.filter(function (id) { return map[id] && map[id].lie; });
    var lieHigh = lieIds.filter(function (id) {
      var v = ans[id]; if (v == null) return false;
      return max2 === 2 ? v === 1 : v >= max2 - 1;
    }).length;

    var profile = DIMS.map(function (d) {
      return { dim: d, name: DIM_NAMES[d], score: dimN[d] ? Math.round(100 * dimSum[d] / dimN[d]) : null, n: dimN[d], near: nearByDim[d] };
    });
    return {
      total: total, answered: answered, missing: total - answered,
      extremeRate: likertCount ? Math.round(100 * extreme / likertCount) : 0,
      consistency: consistency, pairCount: diffs.length, bigGaps: bigGaps,
      fcConflict: fcConflict, fcTotal: fcTotal, fcMissing: fcMissing,
      lieHigh: lieHigh, lieTotal: lieIds.length,
      profile: profile
    };
  }

  g.HMATPersonality = { build: build, score: score, bankMap: bankMap, DIMS: DIMS, DIM_NAMES: DIM_NAMES, PART1_BLOCKS: PART1_BLOCKS };
})(window);
