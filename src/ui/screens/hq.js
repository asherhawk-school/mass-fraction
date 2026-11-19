import { h, money, moneyK, n, km, modal, toast } from '../dom.js';
import { FACILITIES, CONTRACTS, SITES } from '../../data/world.js';
import { availableContracts, acceptContract, buyFacility, hireStaff, trainStaff, dateStr, qualityFactor, advanceDays, isSandbox, buildStatus, note } from '../../model/game.js';
import { templateDesign, newId } from '../../model/vehicle.js';

export function renderHQ(root, app) {
  const g = app.g;
  const payroll = g.staff.reduce((s, x) => s + x.salary, 0) / 12;
  const upkeep = Object.entries(g.facilities).filter(([, v]) => v).reduce((s, [k]) => s + FACILITIES[k].upkeep, 0);
  const burn = payroll + upkeep + 4000;
  const avgSkill = g.staff.reduce((s, x) => s + x.skill, 0) / Math.max(1, g.staff.length);

  const contractsPanel = h('div', { class: 'panel stack' },
    h('h3', null, 'Contracts'),
    g.contracts.active.length ? h('div', { class: 'stack' }, g.contracts.active.map(a => {
      const c = CONTRACTS.find(x => x.id === a.id);
      const left = a.deadlineDay - g.day;
      return h('div', { class: 'panel tight' },
        h('div', { class: 'spread' }, h('b', null, c.title), h('span', { class: 'chip ' + (left < 30 ? 'bad' : left < 90 ? 'warn' : 'good') }, `${Math.max(0, left).toFixed(0)} days left`)),
        h('div', { class: 'sub' }, c.desc), h('div', { class: 'sub' }, `${c.client} · reward ${moneyK(c.reward)} · penalty ${moneyK(c.penalty)} · deadline ${dateStr(g, a.deadlineDay)}`),
        c.kind !== 'test' ? h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn small', onclick: () => newDesignFor(app, c) }, 'Start a new design for this contract')) : null);
    })) : h('div', { class: 'sub' }, 'No active contracts. Accept one below.'),
    h('h4', null, 'Available'),
    h('div', { class: 'stack' }, availableContracts(g).map(c => h('div', { class: 'panel tight' },
      h('div', { class: 'spread' }, h('b', null, c.title), h('span', { class: 'chip acc' }, moneyK(c.reward))),
      h('div', { class: 'sub' }, c.desc),
      h('div', { class: 'sub' }, `${c.client} · ${c.kind === 'test' ? 'ground test' : c.kind} · ${c.deadline} days · advance ${moneyK(c.advance)}${c.site ? ' · ' + SITES[c.site].name : ''}`),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn small primary', onclick: () => { acceptContract(g, c); app.render(); toast(`Signed: ${c.title}`, 'success'); } }, 'Sign contract')))),
      availableContracts(g).length ? null : h('div', { class: 'sub' }, 'Complete current contracts to unlock more.')),
  );

  const facPanel = h('div', { class: 'panel' },
    h('h3', null, 'Facilities'),
    h('div', { class: 'sub', style: { marginBottom: '8px' } }, 'Steps needing a facility you do not own are outsourced: ×2.4 cost, +10 days, slightly worse quality.'),
    h('table', { class: 't' }, h('tbody', null, Object.entries(FACILITIES).map(([k, f]) => h('tr', null,
      h('td', null, h('div', null, f.name), h('div', { class: 'sub' }, f.desc)),
      h('td', { class: 'num' }, g.facilities[k] ? h('span', { class: 'chip good' }, 'Owned') : h('button', { class: 'btn small', disabled: !isSandbox(g) && g.cash < f.cost, onclick: () => { const r = buyFacility(g, k); if (r?.error) toast(r.error, 'fail'); app.render(); } }, moneyK(f.cost))))))),
  );

  const staffPanel = h('div', { class: 'panel stack' },
    h('h3', null, 'Shop crew'),
    h('div', { class: 'kv' }, h('span', null, 'Technicians'), h('span', null, g.staff.length), h('span', null, 'Average skill'), h('span', null, avgSkill.toFixed(2) + ' / 5'), h('span', null, 'Defect-rate multiplier'), h('span', null, '×' + qualityFactor(g).toFixed(2)), h('span', null, 'Monthly burn'), h('span', null, moneyK(burn))),
    h('table', { class: 't' }, h('tbody', null, g.staff.map(s => h('tr', null, h('td', null, s.name), h('td', null, s.role), h('td', { class: 'num' }, s.skill.toFixed(1)), h('td', { class: 'num' }, moneyK(s.salary) + '/yr'))))),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { hireStaff(g, 1.6 + Math.random() * 1.2); app.render(); } }, 'Hire technician'),
      h('button', { class: 'btn small', onclick: () => { hireStaff(g, 3.4 + Math.random() * 0.8); g.staff[g.staff.length - 1].salary += 30000; app.render(); } }, 'Hire senior technician'),
      h('button', { class: 'btn small', onclick: () => { trainStaff(g); app.render(); } }, `Certification training (${moneyK(6000 * g.staff.length)})`),
      g.staff.length > 1 ? h('button', { class: 'btn small', onclick: () => { const s = g.staff.pop(); note(g, `${s.name} laid off.`); app.render(); } }, 'Lay off one') : null),
  );

  const builds = g.builds.slice(-6).reverse();
  const programs = h('div', { class: 'panel stack' },
    h('h3', null, 'Programs'),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => app.go('design') }, 'Open design office'),
      h('button', { class: 'btn small', onclick: () => newTemplate(app, 'sounding') }, '+ Solid sounding rocket'),
      h('button', { class: 'btn small', onclick: () => newTemplate(app, 'liquidSounding') }, '+ Liquid sounding rocket'),
      h('button', { class: 'btn small', onclick: () => newTemplate(app, 'orbit') }, '+ Two-stage orbital')),
    builds.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Vehicle'), h('th', null, 'Status'), h('th', null, 'Parts'))), h('tbody', null, builds.map(b => {
      const st = buildStatus(b);
      return h('tr', { style: { cursor: 'pointer' }, onclick: () => { g.activeBuildId = b.id; app.go(b.status === 'ready' ? 'launch' : 'fab'); } }, h('td', null, b.name), h('td', null, h('span', { class: 'chip ' + (b.status === 'flown' ? '' : b.status === 'ready' ? 'good' : 'acc') }, b.status)), h('td', { class: 'num' }, `${st.done}/${st.total}${st.ncr ? ` · ${st.ncr} NCR` : ''}`));
    }))) : h('div', { class: 'sub' }, 'No hardware in work yet. Release a design for fabrication from the design office.'),
    g.history.length ? h('h4', null, 'Flight history') : null,
    g.history.length ? h('table', { class: 't' }, h('tbody', null, g.history.slice().reverse().slice(0, 8).map(f => h('tr', null, h('td', null, dateStr(g, f.day)), h('td', null, f.name), h('td', null, h('span', { class: 'chip ' + (['orbit', 'recovered'].includes(f.result) ? 'good' : f.result === 'damaged' ? 'warn' : 'bad') }, f.result)), h('td', { class: 'num' }, f.orbit ? `${n(f.orbit.periAlt / 1000, 0)}×${n(f.orbit.apoAlt / 1000, 0)} km` : km(f.apogee)))))) : null,
  );

  const logPanel = h('div', { class: 'panel' },
    h('h3', null, 'Company log'),
    h('div', { class: 'events scroll' }, g.log.slice(0, 80).map(l => h('div', null, h('span', { class: 't' }, dateStr(g, l.day)), h('span', { class: l.kind }, l.text)))),
    h('hr'),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { advanceDays(g, 7); app.render(); } }, 'Wait 1 week'), h('button', { class: 'btn small', onclick: () => showLedger(g) }, 'Ledger')),
  );

  root.append(h('div', { class: 'grid cols-3' },
    h('div', { class: 'stack' }, contractsPanel),
    h('div', { class: 'stack' }, programs, staffPanel),
    h('div', { class: 'stack' }, logPanel, facPanel)));
}

function showLedger(g) {
  modal('Ledger', h('table', { class: 't' }, h('tbody', null, g.ledger.slice(0, 120).map(l => h('tr', null, h('td', { class: 'mono' }, dateStr(g, l.day)), h('td', null, l.desc), h('td', { class: 'num', style: { color: l.amount < 0 ? 'var(--bad)' : 'var(--good)' } }, money(l.amount)))))));
}

function newTemplate(app, kind) {
  const g = app.g;
  const c = g.contracts.active.map(a => CONTRACTS.find(x => x.id === a.id)).find(c => c.kind === (kind === 'orbit' ? 'orbit' : 'suborbital'));
  const d = templateDesign(kind, c || undefined);
  d.id = newId('d'); d.rev = 'A'; d.contractId = c?.id || null;
  if (c?.site) d.program.site = c.site;
  d.name = { sounding: 'Sounding rocket', liquidSounding: 'Liquid sounding rocket', orbit: 'Orbital launcher' }[kind] + ' ' + (g.designs.length + 1);
  g.designs.push(d); g.activeDesignId = d.id;
  app.go('design');
}

function newDesignFor(app, c) {
  const kind = c.kind === 'orbit' ? 'orbit' : c.req.liquid || c.req.apogee > 60000 ? 'liquidSounding' : 'sounding';
  const g = app.g;
  const d = templateDesign(kind, c);
  d.id = newId('d'); d.rev = 'A'; d.contractId = c.id; d.name = c.title + ' vehicle';
  if (c.site) d.program.site = c.site;
  g.designs.push(d); g.activeDesignId = d.id;
  app.go('design');
}
