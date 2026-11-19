// Minimal multi-series line chart on canvas, theme-aware.
import { fitCanvas } from './blueprint.js';
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const SERIES = ['#3a8fd8', '#e0803a', '#3fa66a', '#c8506f', '#8a6ad8', '#b0a030'];

export function lineChart(cv, series, opts = {}) {
  const { ctx, w, h } = fitCanvas(cv, opts.height || 180);
  const pad = { l: 50, r: 10, t: opts.title ? 20 : 8, b: 22 };
  ctx.clearRect(0, 0, w, h);
  const fg = css('--muted') || '#888', gridc = css('--line2') || '#ddd', text = css('--text') || '#111';
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (const [x, y] of s.data) { if (!isFinite(x) || !isFinite(y)) continue; xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  if (!isFinite(xmin)) { ctx.fillStyle = fg; ctx.fillText('No data', 10, 20); return; }
  if (opts.ymin !== undefined) ymin = opts.ymin; if (opts.ymax !== undefined) ymax = opts.ymax;
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  if (xmax === xmin) xmax += 1;
  const yr = ymax - ymin; ymax += yr * 0.05; if (opts.ymin === undefined && ymin !== 0) ymin -= yr * 0.05;
  const X = (x) => pad.l + (x - xmin) / (xmax - xmin) * (w - pad.l - pad.r);
  const Y = (y) => h - pad.b - (y - ymin) / (ymax - ymin) * (h - pad.t - pad.b);
  ctx.font = '10.5px IBM Plex Mono, monospace'; ctx.fillStyle = fg; ctx.strokeStyle = gridc; ctx.lineWidth = 1;
  const nice = (span, n) => { const raw = span / n; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
  const ys = nice(ymax - ymin, 4);
  for (let y = Math.ceil(ymin / ys) * ys; y <= ymax; y += ys) { ctx.beginPath(); ctx.moveTo(pad.l, Y(y) + 0.5); ctx.lineTo(w - pad.r, Y(y) + 0.5); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(fmtTick(y), pad.l - 5, Y(y) + 3); }
  const xs = nice(xmax - xmin, 6);
  ctx.textAlign = 'center';
  for (let x = Math.ceil(xmin / xs) * xs; x <= xmax; x += xs) ctx.fillText(fmtTick(x), X(x), h - 7);
  if (opts.title) { ctx.textAlign = 'left'; ctx.fillStyle = text; ctx.font = '600 11.5px IBM Plex Sans, sans-serif'; ctx.fillText(opts.title, pad.l, 13); }
  for (const [i, s] of series.entries()) {
    ctx.strokeStyle = s.color || SERIES[i % SERIES.length]; ctx.lineWidth = s.width || 1.6;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath(); let started = false;
    for (const [x, y] of s.data) { if (!isFinite(y)) { started = false; continue; } const px = X(x), py = Y(Math.max(ymin, Math.min(ymax, y))); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (series.length > 1 || opts.legend) {
    ctx.textAlign = 'left'; ctx.font = '10.5px IBM Plex Sans, sans-serif';
    let lx = pad.l + 6;
    for (const [i, s] of series.entries()) { ctx.fillStyle = s.color || SERIES[i % SERIES.length]; ctx.fillRect(lx, pad.t + 4, 10, 3); ctx.fillStyle = fg; ctx.fillText(s.name, lx + 14, pad.t + 9); lx += ctx.measureText(s.name).width + 30; }
  }
  for (const m of opts.marks || []) { ctx.strokeStyle = m.color || '#c33'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pad.l, Y(m.y)); ctx.lineTo(w - pad.r, Y(m.y)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = m.color || '#c33'; ctx.textAlign = 'right'; ctx.fillText(m.label, w - pad.r - 2, Y(m.y) - 3); }
}
function fmtTick(v) { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2); }
