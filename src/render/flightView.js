// Flight renderer: Earth-fixed frame, camera follows the vehicle with local-vertical up.
// Sky colour from air density, Earth curvature, plume that widens as ambient pressure falls,
// Mach diamonds at sea level, persistent solid-motor smoke, staging debris, parachutes, orbit map.
import { RE, MU, P_SL } from '../physics/constants.js';
import { atmosphere } from '../physics/atmosphere.js';
import { elements } from '../physics/orbit.js';
import { fitCanvas } from './blueprint.js';

const PLUME = {
  kerolox: { core: [255, 246, 214], mid: [255, 170, 60], edge: [255, 110, 30], alpha: 0.95, diamonds: true },
  hydrolox: { core: [235, 225, 255], mid: [190, 170, 255], edge: [140, 120, 230], alpha: 0.35, diamonds: true },
  methalox: { core: [230, 235, 255], mid: [120, 140, 255], edge: [90, 80, 220], alpha: 0.6, diamonds: true },
  hypergolic: { core: [255, 220, 190], mid: [255, 140, 90], edge: [220, 90, 60], alpha: 0.5, diamonds: false },
  alcolox: { core: [235, 240, 255], mid: [140, 170, 255], edge: [255, 150, 70], alpha: 0.55, diamonds: true },
  solid: { core: [255, 255, 240], mid: [255, 230, 160], edge: [255, 170, 80], alpha: 1.0, diamonds: false },
};

export class FlightView {
  constructor(canvas) { this.cv = canvas; this.trail = []; this.smoke = []; this.stars = Array.from({ length: 220 }, () => [Math.random(), Math.random(), Math.random()]); this.mode = 'track'; this.lastTrailT = -1; }

  ef(sim, x, y) { const th = sim.omegaP * sim.t; const c = Math.cos(th), s = Math.sin(th); return [x * c - y * s, x * s + y * c]; }

  draw(sim) {
    const { ctx, w, h } = fitCanvas(this.cv, this.cv.clientHeight || 560);
    this.w = w; this.h = h;
    const st = sim.state;
    const [vx, vy] = this.ef(sim, st.x, st.y);
    const r = Math.hypot(vx, vy);
    const alt = r - RE;
    if (sim.t - this.lastTrailT > 0.25) { this.trail.push([vx, vy]); this.lastTrailT = sim.t; if (this.trail.length > 6000) this.trail.splice(0, 1000); }
    if (this.mode === 'map') return this.drawMap(ctx, w, h, sim, vx, vy);
    const atm = atmosphere(Math.max(alt, 0));
    // sky
    const dens = Math.min(1, atm.rho / 1.225);
    const sky = (k) => Math.round(k * Math.pow(dens, 0.35));
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgb(${sky(70)},${sky(130)},${sky(215)})`);
    g.addColorStop(1, `rgb(${sky(150)},${sky(195)},${sky(240)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (dens < 0.06) { ctx.fillStyle = `rgba(255,255,255,${(1 - dens / 0.06) * 0.8})`; for (const [a, b, c] of this.stars) ctx.fillRect(a * w, b * h, c > 0.8 ? 2 : 1, c > 0.8 ? 2 : 1); }
    // camera
    const L = sim.an.length;
    const agl = alt - (sim.site.elev || 0);
    // broadcast-style tracking camera: frames the pad at liftoff, then holds the vehicle at a visible size
    const span = Math.max(L * 4, Math.min(agl * 2.4 + L * 2.5, L * 14));
    const scale = span / h; // m per px
    this.scale = scale;
    const phi = Math.atan2(vx, vy);
    const cphi = Math.cos(phi), sphi = Math.sin(phi);
    // the sim tracks the CG; drop the drawn ground by the CG-to-tail distance so the rocket sits on its pad
    const cgNow = sim.massNow?.cg ?? L / 2;
    const tailX = Math.max(...sim.placed.filter(p => p.stage >= sim.stageIdx).map(p => p.x0 + p.len));
    const groundDrop = Math.max(0, tailX - cgNow);
    const vehY = Math.max(h * 0.3, Math.min(h * 0.86, h * 0.9 - (agl + groundDrop) / scale));
    const toS = (px, py) => {
      const dx = px - vx, dy = py - vy;
      const rx = dx * cphi - dy * sphi, ry = dx * sphi + dy * cphi;
      return [w / 2 + rx / scale, vehY - ry / scale];
    };
    const RG = RE - groundDrop;
    // Earth surface (sampled arc around the camera)
    const ang = Math.atan2(vx, vy);
    const halfAng = Math.min(Math.PI, (w * scale) / RE * 1.5 + 0.02);
    ctx.beginPath();
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const a = ang - halfAng + 2 * halfAng * i / N;
      const [sx, sy] = toS(RG * Math.sin(a), RG * Math.cos(a));
      i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    }
    const [bx, by] = toS(vx * 0.0, vy * 0.0);
    ctx.lineTo(w + 2000, h + 4000); ctx.lineTo(-2000, h + 4000); ctx.closePath();
    const site = sim.site;
    const desert = site.name.includes('Desert');
    ctx.fillStyle = desert ? '#a88a5e' : '#1d4e74';
    ctx.fill();
    if (!desert) {
      // coastline: launch complex sits on land; the flight path runs out over the ocean
      ctx.beginPath();
      const a0 = -60000 / RE, a1 = 2500 / RE;
      for (let i = 0; i <= 40; i++) { const a = a0 + (a1 - a0) * i / 40; const [sx, sy] = toS(RG * Math.sin(a), RG * Math.cos(a)); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
      for (let i = 40; i >= 0; i--) { const a = a0 + (a1 - a0) * i / 40; const [sx, sy] = toS((RG - 3000) * Math.sin(a), (RG - 3000) * Math.cos(a)); ctx.lineTo(sx, sy); }
      ctx.closePath(); ctx.fillStyle = '#6f7d4f'; ctx.fill();
    }
    // atmosphere glow when high
    if (alt > 30000) {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) { const a = ang - halfAng + 2 * halfAng * i / N; const [sx, sy] = toS((RE + 60000) * Math.sin(a), (RE + 60000) * Math.cos(a)); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
      ctx.strokeStyle = 'rgba(110,170,255,0.5)'; ctx.lineWidth = Math.max(2, 30000 / scale); ctx.stroke();
    }
    // pad & tower
    const padR = RG + (site.elev || 0);
    const [px, py] = toS(0, padR);
    if (px > -200 && px < w + 200 && py > -200 && py < h + 400) {
      const tH = Math.max(L * 1.2, 10) / scale;
      ctx.fillStyle = '#555'; ctx.fillRect(px - Math.max(3, 0.6 * L / scale), py - tH, Math.max(2, 0.12 * L / scale), tH);
      ctx.fillStyle = '#777'; ctx.fillRect(px - Math.max(10, L * 0.8 / scale), py - 2, Math.max(20, L * 1.6 / scale), 4);
    }
    // smoke particles
    for (const p of this.smoke) {
      const [sx, sy] = toS(p.x, p.y);
      const rr = Math.max(1, p.r / scale);
      if (sx < -rr || sx > w + rr || sy < -rr || sy > h + rr) continue;
      ctx.fillStyle = `rgba(${p.c},${p.c},${p.c},${p.a})`;
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 2 * Math.PI); ctx.fill();
    }
    // trajectory trail
    ctx.strokeStyle = 'rgba(255,220,120,0.6)'; ctx.lineWidth = 1.2; ctx.beginPath();
    this.trail.forEach(([x, y], i) => { const [sx, sy] = toS(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.stroke();
    // debris
    for (const d of sim.debris) {
      const [ex, ey] = this.ef(sim, d.x, d.y);
      const [sx, sy] = toS(ex, ey);
      if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;
      ctx.fillStyle = d.alive ? '#ddd' : '#777'; ctx.fillRect(sx - 2, sy - 2, 4, 4);
      if (d.name !== 'Vehicle debris') { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.fillText(d.name, sx + 5, sy - 4); }
    }
    // vehicle
    const [cx, cy] = toS(vx, vy);
    const att = st.psi + sim.omegaP * sim.t - Math.PI / 2; // body angle in earth-fixed, relative to +y
    const bodyAng = att + phi; // screen rotation: earth-fixed angle then camera rotation
    const S = sim.stages[sim.stageIdx];
    const th = sim._thrust ? sim._thrust(S, atm.P) : { F: 0 };
    const plumeKind = S?.kind === 'solid' ? 'solid' : (S?.e?.plume || 'kerolox');
    const pxLen = L / scale;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-bodyAng);
    if (sim.phase !== 'destroyed') {
      const xs = Math.min(...sim.placed.filter(p => p.stage >= sim.stageIdx).map(p => p.x0));
      const xe = Math.max(...sim.placed.filter(p => p.stage >= sim.stageIdx && !(p.type === 'fairing' && !sim.fairingOn)).map(p => p.x0 + p.len));
      const cg = sim.massNow?.cg ?? (xs + xe) / 2;
      const dRef = sim.dRef;
      const vis = pxLen > 6;
      // plume
      if (th.F > 0 && !sim.capsule) {
        const P = PLUME[plumeKind] || PLUME.kerolox;
        const ambient = Math.min(1, atm.P / P_SL);
        const De = S.kind === 'solid' ? Math.sqrt(S.m.Ae / Math.PI) * 2 : Math.sqrt(S.e.Ae / Math.PI) * 2 * Math.min(3, Math.sqrt(S.count));
        const Lp = Math.max(De * 6, 0.09 * Math.sqrt(th.F)) * (1 + 1.4 * (1 - ambient));
        const half = (4 + 40 * Math.pow(1 - ambient, 3)) * Math.PI / 180; // under-expanded plume balloons as ambient pressure falls
        const fade = 0.3 + 0.7 * Math.pow(ambient, 0.25);
        const y0p = (xe - cg) / scale, Lpx = Math.max(Lp / scale, 12), wx = Math.max(De / scale / 2, 1.5);
        const wEnd = wx + Math.tan(half) * Lpx;
        const flick = 0.92 + 0.16 * Math.random();
        const gr = ctx.createLinearGradient(0, y0p, 0, y0p + Lpx * flick);
        gr.addColorStop(0, `rgba(${P.core},${P.alpha})`); gr.addColorStop(0.18, `rgba(${P.mid},${P.alpha * 0.85 * fade})`); gr.addColorStop(1, `rgba(${P.edge},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(-wx, y0p); ctx.quadraticCurveTo(-wEnd * 0.9, y0p + Lpx * 0.5, -wEnd * 0.3, y0p + Lpx * flick); ctx.lineTo(wEnd * 0.3, y0p + Lpx * flick); ctx.quadraticCurveTo(wEnd * 0.9, y0p + Lpx * 0.5, wx, y0p); ctx.closePath(); ctx.fill();
        if (P.diamonds && ambient > 0.3) {
          ctx.fillStyle = `rgba(255,250,240,${0.55 * ambient})`;
          for (let k = 1; k <= 5; k++) { const yy = y0p + k * Lpx * 0.13; ctx.beginPath(); ctx.ellipse(0, yy, wx * 0.7, Math.max(1.2, wx * 0.45), 0, 0, 2 * Math.PI); ctx.fill(); }
        }
        // smoke
        if (alt < 45000 && Math.random() < 0.9) {
          const back = (xe - cg + Lp * 0.7);
          const ex = vx - Math.sin(att) * back, ey = vy - Math.cos(att) * back;
          const solid = plumeKind === 'solid';
          if (solid || plumeKind === 'kerolox' || plumeKind === 'alcolox') this.smoke.push({ x: ex, y: ey, r: Math.max(De * 2, solid ? 0.4 : 0.2) * (1 + alt / 5000), a: solid ? 0.55 : 0.18, c: solid ? 235 : 120, life: solid ? 400 : 120 });
        }
      }
      if (vis) {
        for (const p of sim.placed) {
          if (p.stage < sim.stageIdx || (p.type === 'fairing' && !sim.fairingOn)) continue;
          if (sim.capsule && (p.stage === sim.n - 1) && ['tank', 'solidMotor', 'liquidEngine', 'motorNozzle', 'fins', 'interstage'].includes(p.type)) continue;
          const y0 = (p.x0 - cg) / scale, y1 = (p.x0 + p.len - cg) / scale, rr = (p.d || dRef) / 2 / scale;
          ctx.fillStyle = p.type === 'tank' ? '#e8e8e4' : p.type === 'interstage' ? '#2b2b2b' : p.type === 'fairing' || p.type === 'nosecone' ? '#f4f4f0' : p.type === 'liquidEngine' || p.type === 'motorNozzle' ? '#555' : '#d8d8d2';
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.6;
          if (p.type === 'nosecone' || p.type === 'fairing') { const Ln = (p.type === 'fairing' ? p.r.draw.Ln : p.len) / scale; ctx.beginPath(); ctx.moveTo(0, y0); ctx.quadraticCurveTo(rr * 1.05, y0 + Ln * 0.25, rr, y0 + Ln); ctx.lineTo(rr, y1); ctx.lineTo(-rr, y1); ctx.lineTo(-rr, y0 + Ln); ctx.quadraticCurveTo(-rr * 1.05, y0 + Ln * 0.25, 0, y0); ctx.fill(); ctx.stroke(); }
          else if (p.type === 'fins') { if (sim.finsLost) continue; const f = p.r.draw; const rb = p.r.aero.d / 2 / scale; for (const s of [1, -1]) { ctx.beginPath(); ctx.moveTo(s * rb, y0); ctx.lineTo(s * (rb + f.span / scale), y0 + f.sweep / scale); ctx.lineTo(s * (rb + f.span / scale), y0 + (f.sweep + f.tip) / scale); ctx.lineTo(s * rb, y0 + f.root / scale); ctx.closePath(); ctx.fillStyle = '#c0392b'; ctx.fill(); } }
          else if (p.type === 'liquidEngine' || p.type === 'motorNozzle') { ctx.beginPath(); ctx.moveTo(-rr * 0.35, y0); ctx.lineTo(-rr, y1); ctx.lineTo(rr, y1); ctx.lineTo(rr * 0.35, y0); ctx.closePath(); ctx.fill(); }
          else if (p.len > 0) { ctx.fillRect(-rr, y0, 2 * rr, y1 - y0); ctx.strokeRect(-rr, y0, 2 * rr, y1 - y0); }
        }
      } else {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(3, 4); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill();
      }
      // transonic vapour cone
      const f = sim._lastF;
      if (f && f.M > 0.92 && f.M < 1.08 && alt < 9000 && th.F > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        const yy = (sim.placed.find(p => p.type === 'interstage' || p.type === 'fairing')?.x0 ?? (xs + xe) * 0.35) - cg;
        ctx.beginPath(); ctx.moveTo(-dRef / scale * 0.6, yy / scale); ctx.lineTo(-dRef / scale * 2.2, yy / scale + dRef * 2.5 / scale); ctx.lineTo(dRef / scale * 2.2, yy / scale + dRef * 2.5 / scale); ctx.lineTo(dRef / scale * 0.6, yy / scale); ctx.closePath(); ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(255,150,40,0.85)'; ctx.beginPath(); ctx.arc(0, 0, 12 + 8 * Math.random(), 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
    // parachute
    if (sim.chute) {
      const rr = Math.max(6, Math.sqrt(sim.chute.CdA) / scale * 1.2);
      const hy = cy - Math.max(20, rr * 2.2);
      ctx.strokeStyle = '#eee'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - rr, hy); ctx.moveTo(cx, cy); ctx.lineTo(cx + rr, hy); ctx.stroke();
      ctx.fillStyle = sim.chute.kind === 'main' ? '#e8742c' : '#f2d23b';
      ctx.beginPath(); ctx.ellipse(cx, hy, rr, rr * 0.6, 0, Math.PI, 2 * Math.PI); ctx.fill();
    }
    // smoke aging
    for (const p of this.smoke) { p.life--; p.r *= 1.006; p.a *= 0.996; }
    this.smoke = this.smoke.filter(p => p.life > 0 && p.a > 0.01);
    if (this.smoke.length > 1500) this.smoke.splice(0, this.smoke.length - 1500);
    this.drawInset(ctx, w, h, sim, vx, vy);
    // scale bar
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '11px IBM Plex Mono, monospace';
    const bar = niceLen(scale * 120);
    ctx.fillRect(w - 20 - bar / scale, h - 22, bar / scale, 2);
    ctx.fillText(bar >= 1000 ? (bar / 1000) + ' km' : bar + ' m', w - 20 - bar / scale, h - 28);
  }

  // Range-safety style inset: altitude vs downrange profile with the instantaneous impact point
  drawInset(ctx, w, h, sim, vx, vy) {
    const W = Math.min(260, w * 0.36), H = 150, x0 = 10, y0 = h - H - 10;
    ctx.fillStyle = 'rgba(5,10,18,0.72)'; ctx.fillRect(x0, y0, W, H);
    ctx.strokeStyle = 'rgba(160,200,230,0.35)'; ctx.strokeRect(x0 + 0.5, y0 + 0.5, W, H);
    const tl = sim.tlm;
    const stride = Math.max(1, Math.floor(tl.length / 400));
    const pts = tl.filter((r, i) => r.t >= 0 && i % stride === 0).map(r => [r.down, r.alt]);
    pts.push([Math.atan2(vx, vy) * RE, Math.hypot(vx, vy) - RE - (sim.site.elev || 0)]);
    let maxD = 1000, maxA = 1000, minD = 0;
    for (const [d, a] of pts) { maxD = Math.max(maxD, d); minD = Math.min(minD, d); maxA = Math.max(maxA, a); }
    const ip = sim.out.iip;
    if (ip !== undefined && isFinite(ip)) { maxD = Math.max(maxD, ip); minD = Math.min(minD, ip); }
    const sx = (W - 30) / Math.max(maxD - minD, 1), sy = (H - 30) / maxA;
    const X = (d) => x0 + 20 + (d - minD) * sx, Y = (a) => y0 + H - 14 - a * sy;
    ctx.strokeStyle = 'rgba(160,200,230,0.5)'; ctx.beginPath(); ctx.moveTo(x0 + 10, Y(0)); ctx.lineTo(x0 + W - 6, Y(0)); ctx.stroke();
    ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 1.4; ctx.beginPath();
    pts.forEach(([d, a], i) => (i ? ctx.lineTo(X(d), Y(Math.max(0, a))) : ctx.moveTo(X(d), Y(Math.max(0, a))))); ctx.stroke();
    const [cd, ca] = pts[pts.length - 1];
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(cd), Y(Math.max(0, ca)), 3, 0, 2 * Math.PI); ctx.fill();
    if (ip !== undefined && isFinite(ip) && sim.stages[sim.stageIdx]?.lit) { ctx.strokeStyle = '#ff6b5c'; ctx.beginPath(); ctx.moveTo(X(ip) - 4, Y(0) - 4); ctx.lineTo(X(ip) + 4, Y(0) + 4); ctx.moveTo(X(ip) + 4, Y(0) - 4); ctx.lineTo(X(ip) - 4, Y(0) + 4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(200,225,245,0.85)'; ctx.font = '10px IBM Plex Mono, monospace';
    ctx.fillText(`ALT ${(maxA / 1000).toFixed(maxA > 1e4 ? 0 : 1)} km`, x0 + 6, y0 + 12);
    ctx.fillText(`DOWNRANGE ${(maxD / 1000).toFixed(maxD > 1e4 ? 0 : 1)} km${ip !== undefined && sim.stages[sim.stageIdx]?.lit ? '   ✕ IIP' : ''}`, x0 + 6, y0 + H - 3);
  }

  drawMap(ctx, w, h, sim, vx, vy) {
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, w, h);
    const st = sim.state;
    const el = elements(st.x, st.y, st.vx, st.vy);
    const r = Math.hypot(vx, vy);
    const ext = Math.max(RE * 1.15, Math.min(isFinite(el.ra) ? el.ra * 1.1 : r * 1.5, RE * 8), r * 1.1);
    const scale = (2 * ext) / Math.min(w, h);
    const cx = w / 2, cy = h / 2;
    const S = (x, y) => [cx + x / scale, cy - y / scale];
    ctx.fillStyle = '#123a5a'; ctx.beginPath(); ctx.arc(cx, cy, RE / scale, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(110,170,255,0.6)'; ctx.lineWidth = Math.max(1, 100000 / scale); ctx.beginPath(); ctx.arc(cx, cy, (RE + 50000) / scale, 0, 2 * Math.PI); ctx.stroke();
    const [px, py] = S(0, RE);
    ctx.fillStyle = '#f0943a'; ctx.fillRect(px - 2, py - 2, 4, 4);
    ctx.strokeStyle = 'rgba(255,220,120,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath();
    this.trail.forEach(([x, y], i) => { const [sx, sy] = S(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
    // osculating orbit (inertial, drawn in the current earth-fixed orientation)
    if (el.e < 1 && sim.phase !== 'destroyed') {
      const th = sim.omegaP * sim.t;
      ctx.strokeStyle = 'rgba(120,200,255,0.7)'; ctx.setLineDash([4, 4]); ctx.beginPath();
      const p = el.a * (1 - el.e * el.e);
      for (let i = 0; i <= 360; i++) {
        const nu = i * Math.PI / 180;
        const rr = p / (1 + el.e * Math.cos(nu));
        const ang = el.argp + (el.h < 0 ? -nu : nu);
        const ix = rr * Math.cos(ang), iy = rr * Math.sin(ang);
        const ex = ix * Math.cos(th) - iy * Math.sin(th), ey = ix * Math.sin(th) + iy * Math.cos(th);
        const [sx, sy] = S(ex, ey);
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const [sx, sy] = S(vx, vy);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 2 * Math.PI); ctx.fill();
    for (const d of sim.debris) { const [ex, ey] = this.ef(sim, d.x, d.y); const [dx, dy] = S(ex, ey); ctx.fillStyle = '#888'; ctx.fillRect(dx - 1.5, dy - 1.5, 3, 3); }
    ctx.fillStyle = '#cde'; ctx.font = '11px IBM Plex Mono, monospace';
    ctx.fillText(`Perigee ${(el.periAlt / 1000).toFixed(0)} km   Apogee ${isFinite(el.apoAlt) ? (el.apoAlt / 1000).toFixed(0) + ' km' : 'escape'}`, 12, h - 12);
  }
}

function niceLen(m) { const p = Math.pow(10, Math.floor(Math.log10(m))); const k = m / p; return (k < 2 ? 1 : k < 5 ? 2 : 5) * p; }
