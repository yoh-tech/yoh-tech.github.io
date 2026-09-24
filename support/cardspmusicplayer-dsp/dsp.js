// CarDSPMusicPlayer — 音づくりのしくみ
// Every curve here is computed from the same formulas the app uses (RBJ biquads, the
// look-ahead limiter), with the same constants as DSPKernel.hpp / DspBands.kt.
(() => {
  "use strict";

  // ---- Constants (shared by the iOS and Android apps) --------------------
  const FS = 48000;
  const BANDS = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
    1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
  const LABELS = ["31.5", "40", "50", "63", "80", "100", "125", "160", "200", "250", "315", "400",
    "500", "630", "800", "1k", "1.25k", "1.6k", "2k", "2.5k", "3.15k", "4k", "5k", "6.3k", "8k",
    "10k", "12.5k", "16k"];
  const GEQ_Q = 4.3;
  const SHELF_Q = 0.707;
  const BASS_HZ = 150;
  const TREBLE_HZ = 4000;
  const SAFE_CEILING_DB = 9;
  const TRIM_MIN_DB = -18;
  const LIM_THRESHOLD = Math.pow(10, -2 / 20);
  const LIM_CEILING = Math.pow(10, -1 / 20);

  const C1 = "#8f73ff";
  const C2 = "#27a89e";
  const GHOST = "rgba(237,240,247,0.28)";

  // ---- RBJ cookbook biquads ---------------------------------------------
  function peaking(f0, q, g) {
    const A = Math.pow(10, g / 40), w0 = 2 * Math.PI * f0 / FS;
    const c = Math.cos(w0), al = Math.sin(w0) / (2 * q);
    const a0 = 1 + al / A;
    return [(1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0, (-2 * c) / a0, (1 - al / A) / a0];
  }
  function lowShelf(f0, q, g) {
    const A = Math.pow(10, g / 40), w0 = 2 * Math.PI * f0 / FS;
    const c = Math.cos(w0), al = Math.sin(w0) / (2 * q), sA = Math.sqrt(A);
    const a0 = (A + 1) + (A - 1) * c + 2 * sA * al;
    return [
      A * ((A + 1) - (A - 1) * c + 2 * sA * al) / a0,
      2 * A * ((A - 1) - (A + 1) * c) / a0,
      A * ((A + 1) - (A - 1) * c - 2 * sA * al) / a0,
      -2 * ((A - 1) + (A + 1) * c) / a0,
      ((A + 1) + (A - 1) * c - 2 * sA * al) / a0,
    ];
  }
  function highShelf(f0, q, g) {
    const A = Math.pow(10, g / 40), w0 = 2 * Math.PI * f0 / FS;
    const c = Math.cos(w0), al = Math.sin(w0) / (2 * q), sA = Math.sqrt(A);
    const a0 = (A + 1) - (A - 1) * c + 2 * sA * al;
    return [
      A * ((A + 1) + (A - 1) * c + 2 * sA * al) / a0,
      -2 * A * ((A - 1) + (A + 1) * c) / a0,
      A * ((A + 1) + (A - 1) * c - 2 * sA * al) / a0,
      2 * ((A - 1) - (A + 1) * c) / a0,
      ((A + 1) - (A - 1) * c - 2 * sA * al) / a0,
    ];
  }
  function magDb(co, f) {
    const [b0, b1, b2, a1, a2] = co;
    const w = 2 * Math.PI * f / FS;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  const F_MIN = 20, F_MAX = 20000, N = 320;
  const FREQS = Array.from({ length: N }, (_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / (N - 1)));
  const response = (filters) => FREQS.map((f) => filters.reduce((s, co) => s + magDb(co, f), 0));

  // ---- Formatting ---------------------------------------------------------
  const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 1 : 2)}kHz` : `${Math.round(f)}Hz`);
  const fmtDb = (v) => `${v >= 0.05 ? "+" : v <= -0.05 ? "−" : "±"}${Math.abs(v).toFixed(1)} dB`;
  const fmtDbFs = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} dB`;

  // ---- Chart primitive (log-frequency or linear-time x axis) -------------
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const tip = document.getElementById("chart-tip");

  function makeChart(host, opts) {
    // Sized to the container at load, so tick labels stay a readable ~11px on phones too
    // instead of a 760-wide drawing being shrunk to fit.
    const W = Math.max(320, Math.min(760, host.clientWidth || 760));
    const narrow = W < 520;
    const H = narrow ? 240 : 320;
    const M = { l: 40, r: 12, t: 28, b: 34 };
    const xTicks = narrow && opts.xTicksNarrow ? opts.xTicksNarrow : opts.xTicks;
    const yTicks = narrow && opts.yTicksNarrow ? opts.yTicksNarrow : opts.yTicks;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.ariaLabel });
    host.appendChild(svg);
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const logX = opts.x === "log";
    const xs = (x) => logX
      ? M.l + (Math.log(x / opts.xMin) / Math.log(opts.xMax / opts.xMin)) * pw
      : M.l + ((x - opts.xMin) / (opts.xMax - opts.xMin)) * pw;
    const xInv = (px) => logX
      ? opts.xMin * Math.pow(opts.xMax / opts.xMin, (px - M.l) / pw)
      : opts.xMin + ((px - M.l) / pw) * (opts.xMax - opts.xMin);
    const ys = (y) => M.t + (1 - (y - opts.yMin) / (opts.yMax - opts.yMin)) * ph;

    const grid = el("g", { class: "grid" }, svg);
    const axes = el("g", {}, svg);
    for (const t of yTicks) {
      el("line", { x1: M.l, x2: W - M.r, y1: ys(t), y2: ys(t) }, grid);
      const tx = el("text", { x: M.l - 8, y: ys(t) + 4, class: "tick", "text-anchor": "end" }, axes);
      tx.textContent = opts.yFmt ? opts.yFmt(t) : `${t > 0 ? "+" : t < 0 ? "−" : ""}${Math.abs(t)}`;
    }
    for (const [v, label] of xTicks) {
      el("line", { x1: xs(v), x2: xs(v), y1: M.t, y2: H - M.b }, grid);
      const tx = el("text", { x: xs(v), y: H - M.b + 18, class: "tick", "text-anchor": "middle" }, axes);
      tx.textContent = label;
    }
    const yTitle = el("text", { x: M.l - 8, y: M.t - 14, class: "axis-title", "text-anchor": "end" }, axes);
    yTitle.textContent = opts.yTitle || "dB";
    const xTitle = el("text", { x: W - M.r, y: H - 4, class: "axis-title", "text-anchor": "end" }, axes);
    xTitle.textContent = opts.xTitle || "Hz";

    const refLayer = el("g", {}, svg);
    const dataLayer = el("g", {}, svg);
    const labelLayer = el("g", {}, svg);
    const hover = el("g", { style: "display:none" }, svg);
    const hLine = el("line", { class: "hover-line", y1: M.t, y2: H - M.b }, hover);
    const hit = el("rect", { x: M.l, y: M.t, width: pw, height: ph, fill: "transparent" }, svg);

    let current = [];
    const dotPool = [];

    function draw(series, refs = []) {
      current = series;
      refLayer.replaceChildren();
      dataLayer.replaceChildren();
      labelLayer.replaceChildren();
      for (const r of refs) {
        el("line", { x1: M.l, x2: W - M.r, y1: ys(r.y), y2: ys(r.y), class: r.solid ? "zero" : "ref" }, refLayer);
        if (r.label) {
          const t = el("text", { x: W - M.r - 4, y: ys(r.y) - 5, class: "ref-label", "text-anchor": "end" }, refLayer);
          t.textContent = r.label;
        }
      }
      for (const s of series) {
        const d = s.ys.map((y, i) => {
          const yy = Math.max(opts.yMin, Math.min(opts.yMax, y));
          return `${i ? "L" : "M"}${xs(s.xs[i]).toFixed(1)},${ys(yy).toFixed(1)}`;
        }).join("");
        el("path", {
          d, class: "series", stroke: s.color, "stroke-width": s.width || 2,
          ...(s.dash ? { "stroke-dasharray": s.dash } : {}),
        }, dataLayer);
        if (s.label && s.labelAt != null) {
          const i = s.labelAt;
          const t = el("text", {
            x: xs(s.xs[i]) + (s.labelDx || 6), y: ys(Math.max(opts.yMin, Math.min(opts.yMax, s.ys[i]))) + (s.labelDy || -8),
            class: "direct-label", "text-anchor": s.labelAnchor || "start",
          }, labelLayer);
          t.textContent = s.label;
        }
      }
    }

    function nearestIndex(s, x) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < s.xs.length; i++) {
        const d = Math.abs((logX ? Math.log(s.xs[i]) : s.xs[i]) - (logX ? Math.log(x) : x));
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    function onMove(evt) {
      const rect = svg.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * W;
      if (px < M.l || px > W - M.r) return onLeave();
      const x = xInv(px);
      const shown = current.filter((s) => s.tip !== false);
      if (!shown.length) return;
      hover.style.display = "";
      const i0 = nearestIndex(shown[0], x);
      const hx = xs(shown[0].xs[i0]);
      hLine.setAttribute("x1", hx);
      hLine.setAttribute("x2", hx);
      shown.forEach((s, k) => {
        const i = nearestIndex(s, x);
        let dot = dotPool[k];
        if (!dot) { dot = el("circle", { r: 4.5, class: "hover-dot" }, hover); dotPool[k] = dot; }
        dot.style.display = "";
        dot.setAttribute("cx", xs(s.xs[i]));
        dot.setAttribute("cy", ys(Math.max(opts.yMin, Math.min(opts.yMax, s.ys[i]))));
        dot.setAttribute("fill", s.color);
      });
      for (let k = shown.length; k < dotPool.length; k++) dotPool[k].style.display = "none";
      const head = opts.xFmt ? opts.xFmt(shown[0].xs[i0]) : fmtHz(shown[0].xs[i0]);
      tip.innerHTML = `<div class="t-head">${head}</div>` + shown.map((s) => {
        const i = nearestIndex(s, x);
        return `<div class="t-row"><i style="background:${s.color}"></i>${s.name}<b>${(opts.valFmt || fmtDb)(s.ys[i])}</b></div>`;
      }).join("");
      tip.classList.add("is-on");
      const tx = Math.min(window.innerWidth - tip.offsetWidth - 8, evt.clientX + 14);
      tip.style.left = `${Math.max(8, tx)}px`;
      tip.style.top = `${evt.clientY - tip.offsetHeight - 12}px`;
    }
    function onLeave() {
      hover.style.display = "none";
      tip.classList.remove("is-on");
    }
    hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerdown", onMove);
    hit.addEventListener("pointerleave", onLeave);

    return { draw, xs, ys };
  }

  const FREQ_TICKS = [[31.5, "31.5"], [63, "63"], [125, "125"], [250, "250"], [500, "500"],
    [1000, "1k"], [2000, "2k"], [4000, "4k"], [8000, "8k"], [16000, "16k"]];
  const FREQ_TICKS_NARROW = [[63, "63"], [250, "250"], [1000, "1k"], [4000, "4k"], [16000, "16k"]];
  const freqChart = (id, aria, yMin = -12, yMax = 12, yTicks = [-12, -9, -6, -3, 0, 3, 6, 9, 12]) =>
    makeChart(document.getElementById(id), {
      x: "log", xMin: F_MIN, xMax: F_MAX, yMin, yMax, yTicks, xTicks: FREQ_TICKS, ariaLabel: aria,
      xTicksNarrow: FREQ_TICKS_NARROW, yTicksNarrow: yTicks.filter((t) => t % 6 === 0),
    });

  // ---- "数値で見る" tables ------------------------------------------------
  const TABLE_FREQS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  function fillTable(id, series, rows = TABLE_FREQS, xFmt = fmtHz, valFmt = fmtDb) {
    const box = document.querySelector(`.data-table[data-for="${id}"] > div`);
    if (!box) return;
    const cols = series.filter((s) => s.tip !== false);
    const idx = (s, x) => {
      let best = 0, bestD = Infinity;
      s.xs.forEach((v, i) => { const d = Math.abs(v - x); if (d < bestD) { bestD = d; best = i; } });
      return best;
    };
    box.innerHTML = `<div class="table-wrap"><table class="dsp-table"><thead><tr><th></th>${cols.map((s) => `<th>${s.name}</th>`).join("")}</tr></thead><tbody>${
      rows.map((x) => `<tr><td>${xFmt(x)}</td>${cols.map((s) => `<td>${valFmt(s.ys[idx(s, x)])}</td>`).join("")}</tr>`).join("")
    }</tbody></table></div>`;
  }
  const legend = (id, items) => {
    const box = document.getElementById(id);
    if (box) box.innerHTML = items.map((it) => `<span style="color:${it.color}"><i class="${it.cls || ""}"></i><em style="color:var(--text-dim);font-style:normal">${it.name}</em></span>`).join("");
  };
  const labelIndexNear = (f) => FREQS.findIndex((x) => x >= f);

  // ---- 4. Bell ------------------------------------------------------------
  (() => {
    const sel = document.getElementById("bell-freq");
    BANDS.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = i; o.textContent = `${LABELS[i]}Hz`;
      if (f === 1000) o.selected = true;
      sel.appendChild(o);
    });
    const gain = document.getElementById("bell-gain");
    const out = document.getElementById("bell-gain-out");
    const chart = freqChart("chart-bell", "1バンドのベル型フィルターの周波数特性");
    const render = () => {
      const f0 = BANDS[+sel.value], g = +gain.value;
      out.textContent = fmtDb(g);
      const ys = response([peaking(f0, GEQ_Q, g)]);
      const peakI = labelIndexNear(f0);
      const s = { name: `${LABELS[+sel.value]}Hz のバンド`, xs: FREQS, ys, color: C1, width: 2.5,
        label: g >= 0 ? "ブースト" : "カット", labelAt: peakI, labelDx: 10, labelDy: g >= 0 ? 4 : 14 };
      chart.draw([s], [{ y: 0, solid: true }]);
      fillTable("chart-bell", [s]);
    };
    sel.addEventListener("change", render);
    gain.addEventListener("input", render);
    render();
  })();

  // ---- 5. 28 bells summed ------------------------------------------------
  (() => {
    const EXAMPLES = {
      smile: [4.5, 4, 3.5, 3, 2.5, 1.5, 0.5, 0, -0.5, -1, -1.5, -2, -2, -2, -2, -1.5, -1, -0.5, 0, 1, 1.5, 2, 2.5, 3, 3, 3.5, 3.5, 3],
      vocal: [-2, -2, -1.5, -1, -0.5, 0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3, 3, 3, 2.5, 2, 1, 0.5, 0, 0, 0, 0],
      clear: [0, 0, 0, 0, 0, 0, -0.5, -1.5, -2.5, -3, -3, -2.5, -1.5, -0.5, 0, 0, 0, 0, 0.5, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0],
    };
    const chart = freqChart("chart-geq", "28バンドのベルと、それを重ねた合計の周波数特性", -9, 9, [-9, -6, -3, 0, 3, 6, 9]);
    legend("legend-geq", [
      { name: "28枚それぞれのベル", color: GHOST, cls: "thin" },
      { name: "重ねた結果", color: C1 },
    ]);
    const render = (key) => {
      const gains = EXAMPLES[key];
      const filters = BANDS.map((f, i) => peaking(f, GEQ_Q, gains[i]));
      const bells = filters.map((co, i) => ({
        name: LABELS[i], xs: FREQS, ys: FREQS.map((f) => magDb(co, f)), color: GHOST, width: 1, tip: false,
      }));
      const sum = { name: "重ねた結果", xs: FREQS, ys: response(filters), color: C1, width: 2.5 };
      chart.draw([...bells, sum], [{ y: 0, solid: true }]);
      fillTable("chart-geq", [sum]);
    };
    document.querySelectorAll("[data-geq]").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll("[data-geq]").forEach((o) => o.classList.toggle("is-on", o === b));
      render(b.dataset.geq);
    }));
    render("smile");
  })();

  // ---- 6. Shelves --------------------------------------------------------
  (() => {
    const bass = document.getElementById("bass"), treble = document.getElementById("treble");
    const bOut = document.getElementById("bass-out"), tOut = document.getElementById("treble-out");
    const chart = freqChart("chart-shelf", "ベースとトレブルの棚型フィルターの周波数特性");
    legend("legend-shelf", [{ name: "ベース", color: C1 }, { name: "トレブル", color: C2 }]);
    const render = () => {
      const gb = +bass.value, gt = +treble.value;
      bOut.textContent = fmtDb(gb);
      tOut.textContent = fmtDb(gt);
      const sb = { name: "ベース", xs: FREQS, ys: response([lowShelf(BASS_HZ, SHELF_Q, gb)]), color: C1, width: 2.5,
        label: "ベース", labelAt: labelIndexNear(40), labelDy: gb >= 0 ? -10 : 18 };
      const st = { name: "トレブル", xs: FREQS, ys: response([highShelf(TREBLE_HZ, SHELF_Q, gt)]), color: C2, width: 2.5,
        label: "トレブル", labelAt: labelIndexNear(9000), labelDy: gt >= 0 ? -10 : 18 };
      chart.draw([sb, st], [{ y: 0, solid: true }]);
      fillTable("chart-shelf", [sb, st]);
    };
    bass.addEventListener("input", render);
    treble.addEventListener("input", render);
    render();
  })();

  // ---- 8. Auto trim ------------------------------------------------------
  (() => {
    const band = document.getElementById("trim-band"), bass = document.getElementById("trim-bass");
    const bOut = document.getElementById("trim-band-out"), sOut = document.getElementById("trim-bass-out");
    const readout = document.getElementById("trim-readout");
    const chart = freqChart("chart-trim", "オートトリムの前後の周波数特性", -12, 18, [-12, -6, 0, 6, 12, 18]);
    legend("legend-trim", [
      { name: "調整したまま", color: GHOST, cls: "dashed" },
      { name: "オートトリム後（実際の音）", color: C1 },
    ]);
    const idx63 = BANDS.indexOf(63);
    const render = () => {
      const g = +band.value, s = +bass.value;
      bOut.textContent = fmtDb(g);
      sOut.textContent = fmtDb(s);
      // Same estimate as the apps: each band plus the shelf that overlaps it, highest one wins.
      let maxGain = 0;
      BANDS.forEach((f, i) => {
        let v = i === idx63 ? g : 0;
        if (f < BASS_HZ) v += s;
        maxGain = Math.max(maxGain, v);
      });
      const trim = Math.max(TRIM_MIN_DB, Math.min(0, SAFE_CEILING_DB - maxGain));
      readout.innerHTML =
        `<div><small>一番持ち上がっているところ</small><b>${fmtDb(maxGain)}</b></div>` +
        `<div><small>上限</small><b>+9.0 dB</b></div>` +
        `<div><small>オートトリム（全体を下げる量）</small><b style="color:${trim < 0 ? C1 : "inherit"}">${trim < 0 ? fmtDb(trim) : "なし"}</b></div>`;
      const before = response([peaking(63, GEQ_Q, g), lowShelf(BASS_HZ, SHELF_Q, s)]);
      const sBefore = { name: "調整したまま", xs: FREQS, ys: before, color: GHOST, width: 2, dash: "6 5" };
      const sAfter = { name: "オートトリム後", xs: FREQS, ys: before.map((v) => v + trim), color: C1, width: 2.5 };
      chart.draw([sBefore, sAfter], [{ y: 0, solid: true }, { y: SAFE_CEILING_DB, label: "+9dB（上限の目安）" }]);
      fillTable("chart-trim", [sBefore, sAfter]);
    };
    band.addEventListener("input", render);
    bass.addEventListener("input", render);
    render();
  })();

  // ---- 9. Look-ahead limiter (time domain) -------------------------------
  (() => {
    const drive = document.getElementById("lim-drive"), out = document.getElementById("lim-drive-out");
    const DUR = 0.4, LA = Math.round(0.003 * FS);
    const releaseCoeff = Math.exp(-1 / (0.1 * FS));
    const smooth = 1 - Math.exp(-1 / (0.001 * FS));
    const chart = makeChart(document.getElementById("chart-limiter"), {
      x: "lin", xMin: 0, xMax: DUR * 1000, yMin: -12, yMax: 9, yTicks: [-12, -9, -6, -3, 0, 3, 6, 9],
      xTicks: [[0, "0"], [100, "100"], [200, "200"], [300, "300"], [400, "400"]],
      yTicksNarrow: [-12, -6, 0, 6],
      xTitle: "ミリ秒", yTitle: "dB", ariaLabel: "リミッターの前後の音の大きさの時間変化",
      xFmt: (ms) => `${Math.round(ms)} ミリ秒`, valFmt: fmtDbFs,
    });
    legend("legend-limiter", [
      { name: "リミッターに入る前", color: GHOST, cls: "dashed" },
      { name: "リミッターを通った後", color: C2 },
    ]);
    // Amplitude envelope: a steady body plus two drum hits (2ms attack, ~50ms decay),
    // scaled so the first hit peaks at 0dB when the slider is at 0dB.
    const envAt = (t) => {
      const hit = (t0, a) => (t < t0 ? 0 : a * Math.exp(-(t - t0) / 0.05) * Math.min(1, (t - t0) / 0.002));
      return 0.3 + hit(0.1, 0.7) + hit(0.26, 0.45);
    };
    const render = () => {
      const d = +drive.value;
      out.textContent = fmtDbFs(d);
      const gainIn = Math.pow(10, d / 20);
      const n = Math.round(DUR * FS);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / FS;
        x[i] = envAt(t) * gainIn * Math.sin(2 * Math.PI * 1000 * t);
      }
      // Same algorithm as the apps: delayed signal * smoothed gain derived from a peak envelope.
      const y = new Float32Array(n);
      const delay = new Float32Array(LA);
      let w = 0, env = 0, g = 1;
      for (let i = 0; i < n; i++) {
        const inc = x[i];
        const delayed = delay[w];
        delay[w] = inc;
        w = (w + 1) % LA;
        env = Math.max(Math.abs(inc), env * releaseCoeff);
        const target = env > LIM_THRESHOLD ? LIM_THRESHOLD / env : 1;
        g += (target - g) * smooth;
        y[i] = Math.max(-LIM_CEILING, Math.min(LIM_CEILING, delayed * g));
      }
      // Per-millisecond peak, output shifted back by the look-ahead so both line up.
      const ms = Math.floor(DUR * 1000) - 4;
      const per = FS / 1000;
      const xsMs = [], inDb = [], outDb = [];
      for (let m = 0; m < ms; m++) {
        let pi = 0, po = 0;
        for (let k = 0; k < per; k++) {
          const i = m * per + k;
          pi = Math.max(pi, Math.abs(x[i]));
          po = Math.max(po, Math.abs(y[i + LA] || 0));
        }
        xsMs.push(m);
        inDb.push(20 * Math.log10(Math.max(pi, 1e-6)));
        outDb.push(20 * Math.log10(Math.max(po, 1e-6)));
      }
      const sIn = { name: "入る前", xs: xsMs, ys: inDb, color: GHOST, width: 2, dash: "6 5" };
      const sOut = { name: "通った後", xs: xsMs, ys: outDb, color: C2, width: 2.5 };
      chart.draw([sIn, sOut], [
        { y: 0, label: "0dB（デジタルの天井）" },
        { y: -1, solid: true, label: "" },
        { y: -2, label: "−2dB（押さえ始める）" },
      ]);
      fillTable("chart-limiter", [sIn, sOut], [50, 100, 110, 150, 200, 260, 270, 300, 350],
        (v) => `${v} ミリ秒`, fmtDbFs);
    };
    drive.addEventListener("input", render);
    render();
  })();
})();
