// To-scale engineering drawing of the vehicle (nose at top), with CG / CP markers and dimensions.
import { NOSE_SHAPES } from '../physics/aero.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function fitCanvas(cv, hCss) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth || 300;
  const hh = hCss ?? (cv.clientHeight || 400);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); cv.style.height = hh + 'px'; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hh };
}

export function drawBlueprint(cv, an, opts = {}) {
  const { ctx, w, h } = fitCanvas(cv, opts.height || 620);
  const line = css('--bpline') || '#78c3f0', grid = css('--bpgrid') || 'rgba(120,195,240,.1)', bg = css('--bp') || '#0a2236';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  if (!an || !an.placed.length) return;
  const L = an.length;
  const maxD = Math.max(...an.placed.map(p => p.d || 0.1));
  const scale = Math.min((h - 70) / L, (w * 0.42) / maxD);
  const cx = w * 0.42, top = 30;
  const X = (x) => top + x * scale;
  ctx.font = '11px IBM Plex Mono, monospace';
  ctx.lineJoin = 'round';
  for (const p of an.placed) {
    const sel = opts.selected && p.id.split(':')[0] === opts.selected;
    ctx.strokeStyle = sel ? '#ffb35c' : line;
    ctx.lineWidth = sel ? 2 : 1.2;
    ctx.fillStyle = sel ? 'rgba(255,179,92,0.12)' : 'rgba(120,195,240,0.06)';
    const y0 = X(p.x0), y1 = X(p.x0 + p.len), r = (p.d || 0.1) / 2 * scale;
    const kind = p.r.draw?.kind;
    if (p.type === 'nosecone' || p.type === 'fairing') {
      const Ln = p.type === 'fairing' ? p.r.draw.Ln : p.len;
      const R = p.d / 2 * scale;
      ctx.beginPath(); ctx.moveTo(cx, y0);
      const shape = p.type === 'fairing' ? 'ogive' : p.r.draw.shape;
      for (let i = 1; i <= 30; i++) {
        const t = i / 30; let rr;
        if (shape === 'conical') rr = t; else if (shape === 'elliptical') rr = Math.sqrt(1 - (1 - t) ** 2); else if (shape === 'vonKarman') { const th = Math.acos(1 - 2 * t); rr = Math.sqrt((th - Math.sin(2 * th) / 2) / Math.PI); } else rr = Math.sqrt(1 - (1 - t) ** 2) * 0.35 + t * 0.65;
        ctx.lineTo(cx + R * rr, y0 + t * Ln * scale);
      }
      ctx.lineTo(cx + R, y1); ctx.lineTo(cx - R, y1); ctx.lineTo(cx - R, y0 + Ln * scale);
      for (let i = 29; i >= 0; i--) {
        const t = i / 30; let rr;
        if (shape === 'conical') rr = t; else if (shape === 'elliptical') rr = Math.sqrt(1 - (1 - t) ** 2); else if (shape === 'vonKarman') { const th = Math.acos(1 - 2 * t); rr = Math.sqrt((th - Math.sin(2 * th) / 2) / Math.PI); } else rr = Math.sqrt(1 - (1 - t) ** 2) * 0.35 + t * 0.65;
        ctx.lineTo(cx - R * rr, y0 + t * Ln * scale);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.type === 'fins') {
      const f = p.r.draw;
      const rb = an.placed.find(q => q.stage === p.stage && q.type !== 'fins')?.d / 2 * scale || r;
      const Rb = (p.r.aero.d / 2) * scale;
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * Rb, y0);
        ctx.lineTo(cx + s * (Rb + f.span * scale), y0 + f.sweep * scale);
        ctx.lineTo(cx + s * (Rb + f.span * scale), y0 + (f.sweep + f.tip) * scale);
        ctx.lineTo(cx + s * Rb, y0 + f.root * scale);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    } else if (p.type === 'liquidEngine') {
      const e = p.r.engine;
      const n = Math.min(e.count, 3);
      const off = n > 1 ? r * 0.55 : 0;
      for (let k = 0; k < n; k++) {
        const ox = cx + (n > 1 ? (k - (n - 1) / 2) * (2 * off / Math.max(1, n - 1)) : 0);
        const pts = e.contour.pts;
        const sx = scale * (e.length / pts[pts.length - 1].x) * 0.98;
        const yb = y0 + (p.len - e.length) * scale;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + q.r * scale, yb + q.x * scale));
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(ox - pts[i].r * scale, yb + pts[i].x * scale);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeRect(ox - e.Dc / 2 * scale * 0.8, y0, e.Dc * scale * 0.8, (p.len - e.length) * scale);
      }
      if (e.count > 3) { ctx.fillStyle = line; ctx.fillText(`×${e.count}`, cx + r + 6, y1 - 4); }
    } else if (p.type === 'motorNozzle') {
      const Rt = r * 0.35;
      ctx.beginPath(); ctx.moveTo(cx - Rt, y0); ctx.lineTo(cx - r, y1); ctx.lineTo(cx + r, y1); ctx.lineTo(cx + Rt, y0); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (p.len > 0) {
      ctx.beginPath(); ctx.rect(cx - r, y0, 2 * r, y1 - y0); ctx.fill(); ctx.stroke();
      if (p.type === 'tank') {
        const dh = p.r.tank.domeH * scale;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.ellipse(cx, y0 + dh, r * 0.98, dh, 0, Math.PI, 2 * Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, y1 - dh, r * 0.98, dh, 0, 0, Math.PI); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = p.r.tank.role === 'ox' ? 'rgba(80,160,255,0.18)' : 'rgba(255,170,60,0.16)';
        ctx.fillRect(cx - r + 2, y0 + dh, 2 * r - 4, y1 - y0 - 2 * dh);
        ctx.fillStyle = line; ctx.fillText(p.r.tank.liquid.name.replace('Liquid ', 'L').slice(0, 14), cx - r + 4, (y0 + y1) / 2 + 4);
      }
      if (p.type === 'solidMotor') {
        ctx.fillStyle = 'rgba(200,200,200,0.12)';
        const core = (p.r.motor ? 0.3 : 0.3) * r;
        ctx.fillRect(cx - r + 2, y0 + 3, r - core - 2, y1 - y0 - 6); ctx.fillRect(cx + core, y0 + 3, r - core - 2, y1 - y0 - 6);
      }
      if (p.type === 'interstage') { ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(cx - r - 8, y1); ctx.lineTo(cx + r + 8, y1); ctx.stroke(); ctx.setLineDash([]); }
    }
    // labels
    if (p.len * scale > 12 && p.type !== 'fins') {
      ctx.fillStyle = sel ? '#ffb35c' : 'rgba(170,215,245,0.85)';
      const lbl = { nosecone: 'NOSE', fairing: 'FAIRING', payload: 'PAYLOAD', airframe: 'AIRFRAME', avionics: 'AVIONICS', recovery: 'RECOVERY', solidMotor: 'SRM', tank: p.r.tank?.role === 'ox' ? 'OX TANK' : 'FUEL TANK', interstage: 'INTERSTAGE', liquidEngine: 'ENGINE', motorNozzle: '' }[p.type] ?? '';
      ctx.fillText(lbl, cx + Math.max(r, 0) + 22, (y0 + y1) / 2 + 4);
      ctx.strokeStyle = 'rgba(120,195,240,0.35)'; ctx.beginPath(); ctx.moveTo(cx + r + 2, (y0 + y1) / 2); ctx.lineTo(cx + r + 18, (y0 + y1) / 2); ctx.stroke();
    }
  }
  // dimension line
  ctx.strokeStyle = line; ctx.fillStyle = line; ctx.lineWidth = 1;
  const dx = cx - maxD / 2 * scale - 26;
  ctx.beginPath(); ctx.moveTo(dx, X(0)); ctx.lineTo(dx, X(L)); ctx.moveTo(dx - 4, X(0)); ctx.lineTo(dx + 4, X(0)); ctx.moveTo(dx - 4, X(L)); ctx.lineTo(dx + 4, X(L)); ctx.stroke();
  ctx.save(); ctx.translate(dx - 6, (X(0) + X(L)) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(L.toFixed(L < 10 ? 3 : 2) + ' m', 0, 0); ctx.restore();
  // CG / CP markers
  const mark = (x, color, label, kind) => {
    const y = X(x);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
    const mx = cx + maxD / 2 * scale + 70;
    ctx.beginPath(); ctx.arc(mx, y, 7, 0, 2 * Math.PI); ctx.stroke();
    if (kind === 'cg') { ctx.beginPath(); ctx.moveTo(mx, y); ctx.arc(mx, y, 7, 0, Math.PI / 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(mx, y); ctx.arc(mx, y, 7, Math.PI, 1.5 * Math.PI); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(mx, y, 3, 0, 2 * Math.PI); ctx.fill(); }
    ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(cx - maxD / 2 * scale, y); ctx.lineTo(mx - 9, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillText(label, mx + 12, y + 4);
  };
  mark(an.cg, '#7fd3ff', `CG ${an.cg.toFixed(2)} m`, 'cg');
  if (an.cp > 0) mark(an.cp, '#ff7a6b', `CP ${an.cp.toFixed(2)} m`, 'cp');
  ctx.fillStyle = 'rgba(170,215,245,0.9)';
  const gm = 20 / scale;
  ctx.fillText(`GRID ${gm >= 1 ? gm.toFixed(2) + ' m' : (gm * 1000).toFixed(0) + ' mm'}`, 10, h - 26);
  ctx.fillText(`Static margin ${an.margin.toFixed(2)} cal`, 10, h - 10);
}
