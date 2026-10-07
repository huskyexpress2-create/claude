/* 자료해석용 SVG 차트 렌더러. ChartSpec 형식은 docs/SCHEMA.md 참고. */
(function (g) {
  var PALETTE = ['#34425f', '#9aa3b5', '#d5d9e1', '#6b86c2', '#5d6575', '#b8c4dd'];
  var MARKERS = ['circle', 'square', 'triangle', 'diamond', 'circle', 'square'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    var r = Math.round(n * 100) / 100;
    return r.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }

  function niceStep(range, count) {
    var raw = range / Math.max(count, 1);
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }
  function scale(min, max, count) {
    if (min === max) { max = min + 1; }
    var step = niceStep(max - min, count || 5);
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    if (hi === max && max !== 0) hi += 0; // 꼭대기 여유는 라벨용 padding으로 처리
    var ticks = [];
    for (var t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
    return { min: lo, max: hi, ticks: ticks };
  }

  function marker(shape, x, y, color) {
    var s = 3.6;
    if (shape === 'square') return '<rect x="' + (x - s) + '" y="' + (y - s) + '" width="' + 2 * s + '" height="' + 2 * s + '" fill="' + color + '" stroke="#222" stroke-width="0.8"/>';
    if (shape === 'triangle') return '<polygon points="' + x + ',' + (y - s - 1) + ' ' + (x - s - 0.5) + ',' + (y + s) + ' ' + (x + s + 0.5) + ',' + (y + s) + '" fill="' + color + '" stroke="#222" stroke-width="0.8"/>';
    if (shape === 'diamond') return '<polygon points="' + x + ',' + (y - s - 1) + ' ' + (x + s + 1) + ',' + y + ' ' + x + ',' + (y + s + 1) + ' ' + (x - s - 1) + ',' + y + '" fill="' + color + '" stroke="#222" stroke-width="0.8"/>';
    return '<circle cx="' + x + '" cy="' + y + '" r="' + s + '" fill="' + color + '" stroke="#222" stroke-width="0.8"/>';
  }

  function legend(items, x, y, maxW) {
    // items: [{name, color, kind:'box'|'line', marker}]
    var out = '', cx = x, cy = y, rowH = 16;
    items.forEach(function (it) {
      var w = 22 + String(it.name).length * 11 + 12;
      if (cx + w > x + maxW && cx > x) { cx = x; cy += rowH; }
      if (it.kind === 'line') {
        out += '<line x1="' + cx + '" y1="' + (cy - 4) + '" x2="' + (cx + 16) + '" y2="' + (cy - 4) + '" stroke="' + it.color + '" stroke-width="2"/>' + marker(it.marker, cx + 8, cy - 4, it.color);
      } else {
        out += '<rect x="' + cx + '" y="' + (cy - 10) + '" width="14" height="11" fill="' + it.color + '" stroke="#222" stroke-width="0.8"/>';
      }
      out += '<text x="' + (cx + 20) + '" y="' + cy + '" font-size="11" fill="#222">' + esc(it.name) + '</text>';
      cx += w;
    });
    return { svg: out, height: cy - y + rowH };
  }

  function estimateLegendRows(items, maxW) {
    var cx = 0, rows = 1;
    items.forEach(function (it) {
      var w = 22 + String(it.name).length * 11 + 12;
      if (cx + w > maxW && cx > 0) { rows++; cx = 0; }
      cx += w;
    });
    return rows;
  }

  function renderPie(spec, W, H) {
    var s = (spec.series && spec.series[0]) || { values: [] };
    var vals = s.values.map(num);
    var total = vals.reduce(function (a, b) { return a + b; }, 0) || 1;
    var cats = spec.categories || [];
    var cx = W * 0.36, cy = H / 2, r = Math.min(W * 0.3, H * 0.42);
    var a0 = -Math.PI / 2, out = '';
    var pctLike = Math.abs(total - 100) < 0.6;
    vals.forEach(function (v, i) {
      var a1 = a0 + (v / total) * Math.PI * 2;
      var large = a1 - a0 > Math.PI ? 1 : 0;
      var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var color = PALETTE[i % PALETTE.length];
      if (vals.length === 1) out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '" stroke="#222"/>';
      else out += '<path d="M' + cx + ',' + cy + ' L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' + color + '" stroke="#222" stroke-width="1"/>';
      var am = (a0 + a1) / 2, lr = r * 0.62;
      var label = pctLike ? fmt(v) + '%' : fmt(v);
      if (v / total > 0.045) {
        var dark = i % PALETTE.length === 0 || i % PALETTE.length === 4;
        out += '<text x="' + (cx + lr * Math.cos(am)).toFixed(1) + '" y="' + (cy + lr * Math.sin(am) + 4).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="600" fill="' + (dark ? '#fff' : '#111') + '">' + esc(label) + '</text>';
      }
      a0 = a1;
    });
    // 오른쪽 범례
    var lx = cx + r + 24, ly = Math.max(18, cy - cats.length * 9);
    cats.forEach(function (c, i) {
      var color = PALETTE[i % PALETTE.length];
      out += '<rect x="' + lx + '" y="' + (ly + i * 18 - 10) + '" width="13" height="11" fill="' + color + '" stroke="#222" stroke-width="0.8"/>';
      out += '<text x="' + (lx + 19) + '" y="' + (ly + i * 18) + '" font-size="11.5" fill="#222">' + esc(c) + (pctLike ? '' : ' (' + fmt(vals[i]) + ')') + '</text>';
    });
    return out;
  }

  function render(spec, opts) {
    opts = opts || {};
    var W = opts.width || 560, H = opts.height || 300;
    var type = spec.type || 'bar';
    var body = '';
    if (type === 'pie') {
      body = renderPie(spec, W, H);
      return wrap(body, W, H);
    }
    var cats = spec.categories || [];
    var series = (spec.series || []).map(function (s, i) {
      return { name: s.name, values: (s.values || []).map(num), as: s.as || (type === 'line' ? 'line' : 'bar'), axis: s.axis || 'left', unit: s.unit, color: PALETTE[i % PALETTE.length], marker: MARKERS[i % MARKERS.length] };
    });
    var horizontal = type === 'hbar';
    var stacked = type === 'stacked';
    var left = series.filter(function (s) { return s.axis !== 'right'; });
    var right = series.filter(function (s) { return s.axis === 'right'; });
    var showLegend = series.length > 1;
    var legendItems = series.map(function (s) { return { name: s.name + (s.axis === 'right' && s.unit ? '(' + s.unit + ', 우축)' : s.axis === 'right' ? '(우축)' : ''), color: s.color, kind: s.as === 'line' ? 'line' : 'box', marker: s.marker }; });
    var legendRows = showLegend ? estimateLegendRows(legendItems, W - 40) : 0;
    var maxCatLen = cats.reduce(function (m, c) { return Math.max(m, String(c).length); }, 0);
    var pad = {
      l: horizontal ? Math.min(140, 16 + maxCatLen * 12) : 50,
      r: right.length ? 50 : 18,
      t: 22,
      b: (horizontal ? 26 : (maxCatLen > 6 && cats.length > 5 ? 52 : 34)) + legendRows * 16 + (showLegend ? 6 : 0)
    };
    var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

    function extent(list, isStack) {
      var lo = 0, hi = 0;
      if (isStack) {
        cats.forEach(function (_, ci) {
          var pos = 0, neg = 0;
          list.forEach(function (s) { var v = s.values[ci] || 0; if (v >= 0) pos += v; else neg += v; });
          hi = Math.max(hi, pos); lo = Math.min(lo, neg);
        });
      } else {
        list.forEach(function (s) { s.values.forEach(function (v) { hi = Math.max(hi, v); lo = Math.min(lo, v); }); });
      }
      return [lo, hi];
    }
    var le = extent(left.filter(function (s) { return s.as !== 'line'; }).length ? left : left, stacked);
    var allLine = left.length && left.every(function (s) { return s.as === 'line'; });
    var lmin = le[0], lmax = le[1];
    if (allLine) {
      var vals = []; left.forEach(function (s) { vals = vals.concat(s.values); });
      var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
      var span = mx - mn || Math.abs(mx) || 1;
      lmin = mn >= 0 && mn - span * 0.6 > 0 ? mn - span * 0.6 : Math.min(0, mn);
      lmax = mx;
    }
    var ls = scale(lmin, lmax * (stacked ? 1.14 : 1.08) || 1, 5);
    var rs = null;
    if (right.length) {
      var re = extent(right, false);
      var rv = []; right.forEach(function (s) { rv = rv.concat(s.values); });
      var rmn = Math.min.apply(null, rv);
      rs = scale(rmn > 0 ? Math.max(0, rmn - (re[1] - rmn) * 0.8) : re[0], re[1] * 1.08 || 1, 5);
    }

    function yOf(v, sc) { return pad.t + ph - (v - sc.min) / (sc.max - sc.min) * ph; }
    function xOf(v, sc) { return pad.l + (v - sc.min) / (sc.max - sc.min) * pw; }

    var out = '';
    // 격자 + 축
    if (!horizontal) {
      ls.ticks.forEach(function (t) {
        var y = yOf(t, ls);
        out += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (pad.l + pw) + '" y2="' + y.toFixed(1) + '" stroke="#e3e5ea" stroke-width="1"/>';
        out += '<text x="' + (pad.l - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="#444">' + fmt(t) + '</text>';
      });
      if (rs) rs.ticks.forEach(function (t) {
        var y = yOf(t, rs);
        out += '<text x="' + (pad.l + pw + 6) + '" y="' + (y + 4).toFixed(1) + '" font-size="10.5" fill="#444">' + fmt(t) + '</text>';
      });
      out += '<line x1="' + pad.l + '" y1="' + pad.t + '" x2="' + pad.l + '" y2="' + (pad.t + ph) + '" stroke="#555"/>';
      if (rs) out += '<line x1="' + (pad.l + pw) + '" y1="' + pad.t + '" x2="' + (pad.l + pw) + '" y2="' + (pad.t + ph) + '" stroke="#555"/>';
      var zeroY = yOf(Math.max(ls.min, 0), ls);
      out += '<line x1="' + pad.l + '" y1="' + zeroY.toFixed(1) + '" x2="' + (pad.l + pw) + '" y2="' + zeroY.toFixed(1) + '" stroke="#555"/>';
    } else {
      ls.ticks.forEach(function (t) {
        var x = xOf(t, ls);
        out += '<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (pad.t + ph) + '" stroke="#e3e5ea"/>';
        out += '<text x="' + x.toFixed(1) + '" y="' + (pad.t + ph + 15) + '" text-anchor="middle" font-size="10.5" fill="#444">' + fmt(t) + '</text>';
      });
      out += '<line x1="' + xOf(Math.max(ls.min, 0), ls).toFixed(1) + '" y1="' + pad.t + '" x2="' + xOf(Math.max(ls.min, 0), ls).toFixed(1) + '" y2="' + (pad.t + ph) + '" stroke="#555"/>';
    }

    var n = cats.length || 1;
    var band = (horizontal ? ph : pw) / n;
    var bars = series.filter(function (s) { return s.as !== 'line'; });
    var lines = series.filter(function (s) { return s.as === 'line'; });
    var nb = stacked ? 1 : Math.max(bars.length, 1);
    var inner = band * 0.72, bw = inner / nb;
    var labelBars = !stacked && cats.length * nb <= 24;

    cats.forEach(function (c, ci) {
      var b0 = (horizontal ? pad.t : pad.l) + ci * band + (band - inner) / 2;
      if (stacked) {
        var accPos = 0, accNeg = 0;
        bars.forEach(function (s) {
          var v = s.values[ci] || 0;
          var from = v >= 0 ? accPos : accNeg, to = from + v;
          if (v >= 0) accPos = to; else accNeg = to;
          var y1 = yOf(Math.max(from, to), ls), y2 = yOf(Math.min(from, to), ls);
          out += '<rect x="' + b0.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + inner.toFixed(1) + '" height="' + Math.max(0, y2 - y1).toFixed(1) + '" fill="' + s.color + '" stroke="#222" stroke-width="0.8"/>';
          if (y2 - y1 > 13) {
            var dark = s.color === PALETTE[0] || s.color === PALETTE[4];
            out += '<text x="' + (b0 + inner / 2).toFixed(1) + '" y="' + ((y1 + y2) / 2 + 4).toFixed(1) + '" text-anchor="middle" font-size="10" fill="' + (dark ? '#fff' : '#111') + '">' + fmt(v) + '</text>';
          }
        });
        out += '<text x="' + (b0 + inner / 2).toFixed(1) + '" y="' + (yOf(accPos, ls) - 4).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="600" fill="#111">' + fmt(accPos + accNeg) + '</text>';
      } else {
        bars.forEach(function (s, si) {
          var v = s.values[ci] || 0;
          if (!horizontal) {
            var x = b0 + si * bw;
            var y1 = yOf(Math.max(v, 0), ls), y2 = yOf(Math.min(v, 0), ls);
            out += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + (bw * 0.92).toFixed(1) + '" height="' + Math.max(0, y2 - y1).toFixed(1) + '" fill="' + s.color + '" stroke="#222" stroke-width="0.8"/>';
            if (labelBars) out += '<text x="' + (x + bw * 0.46).toFixed(1) + '" y="' + (v >= 0 ? y1 - 4 : y2 + 11).toFixed(1) + '" text-anchor="middle" font-size="' + (nb > 2 ? 9 : 10) + '" fill="#111">' + fmt(v) + '</text>';
          } else {
            var y = b0 + si * bw;
            var x1 = xOf(Math.min(v, 0), ls), x2 = xOf(Math.max(v, 0), ls);
            out += '<rect x="' + x1.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(0, x2 - x1).toFixed(1) + '" height="' + (bw * 0.9).toFixed(1) + '" fill="' + s.color + '" stroke="#222" stroke-width="0.8"/>';
            if (labelBars) out += '<text x="' + (x2 + 4).toFixed(1) + '" y="' + (y + bw * 0.45 + 4).toFixed(1) + '" font-size="10" fill="#111">' + fmt(v) + '</text>';
          }
        });
      }
      // 범주 라벨
      if (!horizontal) {
        var cxm = b0 + inner / 2;
        var lab = String(c);
        if (lab.length > 6 && cats.length > 5) {
          out += '<text x="' + cxm.toFixed(1) + '" y="' + (pad.t + ph + 14) + '" text-anchor="end" font-size="10.5" fill="#222" transform="rotate(-30 ' + cxm.toFixed(1) + ' ' + (pad.t + ph + 14) + ')">' + esc(lab) + '</text>';
        } else {
          out += '<text x="' + cxm.toFixed(1) + '" y="' + (pad.t + ph + 16) + '" text-anchor="middle" font-size="11" fill="#222">' + esc(lab) + '</text>';
        }
      } else {
        out += '<text x="' + (pad.l - 6) + '" y="' + (b0 + inner / 2 + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#222">' + esc(c) + '</text>';
      }
    });

    // 선 계열
    lines.forEach(function (s) {
      var sc = s.axis === 'right' && rs ? rs : ls;
      var pts = s.values.map(function (v, ci) {
        var x = pad.l + ci * band + band / 2;
        return [x, yOf(v, sc)];
      });
      var color = bars.length ? '#111' : s.color;
      var dash = bars.length && lines.indexOf(s) > 0 ? ' stroke-dasharray="5 3"' : '';
      out += '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + (bars.length ? '#111' : s.color === PALETTE[2] ? '#8a93a6' : s.color) + '" stroke-width="1.8"' + dash + '/>';
      pts.forEach(function (p, ci) {
        out += marker(s.marker, p[0], p[1], bars.length ? '#fff' : s.color);
        if (cats.length * Math.max(lines.length, 1) <= 30) {
          // 선이 여러 개면 짝수 번째 계열 라벨은 점 아래에 두어 겹침을 줄인다.
          var below = lines.length > 1 && lines.indexOf(s) % 2 === 1;
          out += '<text x="' + p[0].toFixed(1) + '" y="' + (below ? p[1] + 15 : p[1] - 7).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="#111">' + fmt(s.values[ci]) + '</text>';
        }
      });
      if (bars.length) legendItems.forEach(function (li) { if (li.name.indexOf(s.name) === 0 && li.kind === 'line') li.color = '#111'; });
      void color;
    });

    if (showLegend) {
      var lg = legend(legendItems, 20, H - legendRows * 16 + 4, W - 40);
      out += lg.svg;
    }
    return wrap(out, W, H);
  }

  function wrap(body, W, H) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" role="img" font-family="Pretendard, \'Noto Sans KR\', sans-serif"><rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>' + body + '</svg>';
  }

  g.HMATCharts = { render: render, fmt: fmt };
})(typeof window !== 'undefined' ? window : globalThis);
