(async function () {
  const cssHref = document.querySelector('link[href*="static/style.css"]').getAttribute('href');
  const v = (cssHref.match(/\?v=([^&]+)/) || [])[1] || '';
  const base = cssHref.replace(/static\/style\.css.*$/, '');
  const $ = id => document.getElementById(id);
  const input = $('q'); if (!input) return;
  const out = $('result'), menu = $('q-menu'), status = $('search-status');
  const year = input.dataset.year || '';
  const fmt = n => n == null ? '—' : (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // Normalization mirrors scripts/normalize.py norm_name(): drop Inc/LLC/Corp… and non-alphanumerics.
  const norm = s => (s || '').toLowerCase().replace(/\b(inc|incorporated|llc|l\.l\.c|corp|corporation|company|ltd|lp|l\.p|plc|the)\b\.?/g, ' ').replace(/[^a-z0-9]/g, '');
  const say = msg => { status.hidden = !msg; status.textContent = msg || ''; };
  // Companies list (8k rows) loads in the background; establishment shards (~1,100 files keyed by the first two letters) load on demand.
  let COMP = [];
  const compReady = (async () => { try { const r = await fetch(base + 'static/companies.json?v=' + v); if (!r.ok) throw new Error(r.status); COMP = (await r.json()).map(a => ({ kind: 'co', name: a[0], slug: a[1], n: a[2], trc: a[3], emp: a[4], dart: a[5], deaths: a[6], q: norm(a[0]) })); } catch (e) { COMP = []; } })();
  const SH = {}, pending = new Map();
  async function shard(k) {
    if (SH[k]) return SH[k];
    if (pending.has(k)) return pending.get(k);
    const p = (async () => {
      const r = await fetch(base + `static/shards/${k}.json?v=` + v);
      if (r.status === 404) { SH[k] = []; return SH[k]; }
      if (!r.ok) throw new Error('Search data unavailable');
      SH[k] = (await r.json()).map(a => ({ kind: 'est', id: a[0], name: a[1], city: a[2], st: a[3], naics: a[4], emp: a[5], trc: a[6], dart: a[7], deaths: a[8], path: a[9], co: a[10], hasInd: !!a[11], q: norm(a[1]) }));
      return SH[k];
    })();
    pending.set(k, p);
    try { return await p; } finally { pending.delete(k); }
  }
  let items = [], active = -1, seq = 0;
  function card(c) {
    if (c.kind === 'co') return `<section class="sheet quiet"><p class="sheet-label">${esc(c.name)} · ${year} · company-name group · ${c.n} filing sites</p><div class="sheet-num"><span class="num">${fmt(c.trc)}</span><span class="pct">nonfatal cases per 100 FTE workers</span></div>${c.deaths ? `<p class="fatality-note">${c.deaths} reported workplace ${c.deaths === 1 ? 'fatality' : 'fatalities'} · ${year}</p>` : ''}<p class="sheet-title">DART ${fmt(c.dart)} · reported fatalities ${c.deaths || 0} · ${c.emp.toLocaleString('en-US')} workers</p><p class="sheet-text">Hours-weighted across the sites OSHA filings list under this company name. The company page shows which sites are included and how the rate compares with reporting sites in its industry.</p><p class="sheet-actions"><a class="next" href="${base}company/${esc(c.slug)}/">View included worksites</a></p></section>`;
    return `<section class="sheet quiet"><p class="sheet-label">${esc(c.name)} · ${year} · ${esc(c.city)}, ${esc(c.st)} · ${c.emp.toLocaleString('en-US')} workers · NAICS ${esc(c.naics)}</p><div class="sheet-num"><span class="num">${fmt(c.trc)}</span><span class="pct">nonfatal cases per 100 FTE workers</span></div>${c.deaths ? `<p class="fatality-note">${c.deaths} reported workplace ${c.deaths === 1 ? 'fatality' : 'fatalities'} · ${year}</p>` : ''}<p class="sheet-title">DART ${fmt(c.dart)} · reported fatalities ${c.deaths || 0}</p><p class="sheet-text">${c.trc == null ? "Rate withheld by InjuryRate's plausibility checks (hours or headcount in the filing fall outside the expected range); this does not establish that the filing is incorrect. " : ''}${c.path ? 'The site page has the three-year record and the industry comparison.' : c.hasInd ? 'Sites under 250 workers have no page of their own; the industry page gives the comparison.' : 'Sites under 250 workers have no page of their own.'}</p><p class="sheet-actions">${c.path ? `<a class="next" href="${base}${esc(c.path)}">Site record & benchmark</a>` : c.hasInd ? `<a class="next" href="${base}industry/${esc(c.naics)}/">Industry benchmark</a>` : `<a class="next" href="${base}methodology/">How rates are computed</a>`}<a class="next" href="https://www.osha.gov/ords/imis/establishment.search?establishment=${encodeURIComponent(c.name)}&state=${encodeURIComponent(c.st)}" target="_blank" rel="noopener">OSHA inspections</a></p></section>`;
  }
  function paintActive() {
    const options = [...menu.querySelectorAll('[role="option"]')];
    options.forEach((el, i) => { el.id = `q-option-${i}`; el.setAttribute('aria-selected', String(i === active)); });
    const sel = options[active];
    if (sel) { input.setAttribute('aria-activedescendant', sel.id); sel.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  }
  async function open(q) {
    const my = ++seq;
    const words = q.trim().split(/\s+/).filter(Boolean);
    while (words.length && !norm(words[0])) words.shift();  // "The Home Depot" → start from "home"
    const nq = norm(q);
    if (nq.length < 2) { items = []; menu.innerHTML = '<li class="empty">Type at least two letters of the employer name.</li>'; menu.hidden = false; return; }
    menu.innerHTML = '<li class="empty">Searching…</li>'; menu.hidden = false;
    let hits = [], cos = [], failed = false;
    try {
      await compReady; if (my !== seq) return;
      cos = COMP.filter(c => c.q.includes(nq)).slice(0, 3);
      const first = norm(words[0] || '');
      const ests = await shard((first + 'zz').slice(0, 2)); if (my !== seq) return;
      const rest = words.slice(1).map(norm).filter(Boolean);
      hits = ests.filter(e => e.q.startsWith(first) && rest.every(w => (e.q + norm(e.city) + e.st.toLowerCase() + e.co).includes(w))).sort((a, b) => b.emp - a.emp).slice(0, 8 - cos.length);
    } catch (e) { if (my !== seq) return; failed = true; }
    items = [...cos, ...hits];
    menu.innerHTML = items.length ? items.map((c, i) => `<li role="option" id="q-option-${i}" data-i="${i}" aria-selected="${i === active}">${esc(c.name)}<small class="muted"> ${c.kind === 'co' ? `company · ${c.n} sites` : `${esc(c.city)}, ${esc(c.st)} · ${c.emp.toLocaleString('en-US')} workers`} · TRC ${fmt(c.trc)}${c.deaths ? ` · ${c.deaths} fatalit${c.deaths === 1 ? 'y' : 'ies'}` : ''}</small></li>`).join('') : `<li class="empty">${failed ? 'Search data could not be loaded. Please try again.' : 'No filing by that name. Establishment names are as the employer typed them — try a shorter form or add the city.'}</li>`;
    menu.hidden = false; input.setAttribute('aria-expanded', 'true'); paintActive();
  }
  function close() { ++seq; menu.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function leaveLanding() {
    const html = document.documentElement; if (!html.classList.contains('landing')) return;
    const stage = $('stage'), hero = stage.firstElementChild;
    const y0 = hero.getBoundingClientRect().top;
    html.classList.remove('landing');
    const dy = y0 - hero.getBoundingClientRect().top;
    if (dy > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stage.style.transition = 'none'; stage.style.transform = `translateY(${dy}px)`; void stage.offsetHeight;
      stage.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)'; stage.style.transform = 'translateY(0)';
      stage.addEventListener('transitionend', () => { stage.style.transition = ''; stage.style.transform = ''; }, { once: true });
    }
    if (window.__reveal) window.__reveal($('below'), true, 300);
  }
  function show(html) { leaveLanding(); out.classList.remove('reveal', 'is-in'); out.innerHTML = html; }
  function choose(c) {
    input.value = c.name; close(); show(card(c));
    say(`${c.name}. ${year} nonfatal case rate ${fmt(c.trc)} per 100 full-time-equivalent workers${c.deaths ? `, ${c.deaths} reported fatalit${c.deaths === 1 ? 'y' : 'ies'}` : ''}.`);
    localStorage.setItem('injuryrate.q', JSON.stringify(c.kind === 'co' ? ['co', c.slug] : ['est', c.id, (c.q + 'zz').slice(0, 2)]));
    if (innerWidth < 900) setTimeout(() => out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 60);
  }
  input.addEventListener('focus', () => { setTimeout(() => input.select(), 0); open(input.value); });
  input.addEventListener('input', () => { items = []; active = -1; input.removeAttribute('aria-activedescendant'); open(input.value); });
  input.addEventListener('keydown', e => {
    if (menu.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); paintActive(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); paintActive(); e.preventDefault(); }
    else if (e.key === 'Enter') { const it = items[active >= 0 ? active : 0]; if (it) choose(it); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  menu.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { choose(items[+li.dataset.i]); e.preventDefault(); } });
  input.addEventListener('blur', () => setTimeout(close, 120));
  const rem = JSON.parse(localStorage.getItem('injuryrate.q') || 'null');
  let remembered = null;
  try {
    if (rem && rem[0] === 'co') { await compReady; remembered = COMP.find(c => c.slug === rem[1]); }
    else if (rem && rem[0] === 'est') remembered = (await shard(rem[2])).find(e => e.id === rem[1]);
  } catch (e) { }
  if (remembered) { $('last-name').textContent = remembered.name; $('last').hidden = false; $('last').addEventListener('click', () => choose(remembered)); }
})();
