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
  const say = (msg, busy = false) => { status.hidden = !msg; status.textContent = msg || ''; menu.setAttribute('aria-busy', String(busy)); };
  const store = { get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set: (k, val) => { try { localStorage.setItem(k, JSON.stringify(val)); } catch (e) { } } };
  // Companies list (8k rows) loads in the background; establishment shards (~1,100 files keyed by the first two letters) load on demand.
  // A failed company download is remembered as a failure (not as "no companies") so it can be retried.
  let COMP = null, compReady = null;
  function loadCompanies() {
    if (compReady) return compReady;
    compReady = (async () => { const r = await fetch(base + 'static/companies.json?v=' + v); if (!r.ok) throw new Error(r.status); COMP = (await r.json()).map(a => ({ kind: 'co', name: a[0], slug: a[1], n: a[2], trc: a[3], emp: a[4], dart: a[5], deaths: a[6], q: norm(a[0]) })); return COMP; })();
    compReady.catch(() => { compReady = null; });
    return compReady;
  }
  loadCompanies().catch(() => {});
  const MEMBERS = {};
  async function members(slug) {  // every filing in a company-name group, loaded once
    if (MEMBERS[slug]) return MEMBERS[slug];
    const r = await fetch(base + `static/company-sites/${slug}.json?v=` + v); if (!r.ok) throw new Error(r.status);
    MEMBERS[slug] = (await r.json()).members; return MEMBERS[slug];
  }
  const SH = {}, pending = new Map();
  async function shard(k) {
    if (SH[k]) return SH[k];
    if (pending.has(k)) return pending.get(k);
    const p = (async () => {
      const r = await fetch(base + `static/shards/${k}.json?v=` + v);
      if (r.status === 404) { SH[k] = []; return SH[k]; }
      if (!r.ok) throw new Error('Search data unavailable');
      SH[k] = (await r.json()).map(a => ({ kind: 'est', id: a[0], name: a[1], city: a[2], st: a[3], naics: a[4], emp: a[5], trc: a[6], dart: a[7], deaths: a[8], path: a[9], co: a[10], hasInd: !!a[11], cases: a[12], hrs: a[13], benchCode: a[14], benchMedian: a[15], benchN: a[16], status: a[17], q: norm(a[1]) }));
      return SH[k];
    })();
    pending.set(k, p);
    try { return await p; } finally { pending.delete(k); }
  }
  let items = [], active = -1, seq = 0;
  const n0 = n => n == null ? 'Not available' : n.toLocaleString('en-US');
  const deathsLine = c => c.deaths ? `<p class="fatality-note">${c.deaths} reported workplace ${c.deaths === 1 ? 'fatality' : 'fatalities'} · ${year}</p>` : '';
  function card(c) {
    if (c.kind === 'co') return `<section class="sheet quiet"><p class="sheet-label">${esc(c.name)} · ${year} · company-name group · ${c.n} filing sites</p><div class="sheet-num"><span class="num">${fmt(c.trc)}</span><span class="pct">nonfatal cases per 100 full-time-equivalent workers</span></div>${deathsLine(c)}<p class="sheet-title">DART ${fmt(c.dart)} · reported fatalities ${c.deaths || 0} · ${n0(c.emp)} workers</p><p class="sheet-text">Rate based on the name-matched filings that passed InjuryRate's plausibility checks; this group is not a verified corporate ownership record. Hours-weighted across sites.</p><div id="co-sites" class="muted small">Loading this group's worksites…</div><p class="sheet-actions"><a class="next" href="${base}company/${esc(c.slug)}/">Company record & yearly figures</a><a class="next" href="${base}static/company-sites/${esc(c.slug)}.json" download>Download all matched filings</a></p></section>`;
    const status = c.status === 'invalid' ? "Rate not calculated: the filing is missing or has malformed hours, headcount or case counts. " : c.status === 'screened_out' ? "Rate withheld by InjuryRate's plausibility checks (hours or headcount in the filing fall outside the expected range); this does not establish that the filing is incorrect. " : '';
    const basis = c.trc != null ? `${n0(c.cases)} nonfatal recordable case${c.cases === 1 ? '' : 's'} over ${n0(c.hrs)} hours worked in ${year}.` : '';
    const bench = c.benchMedian != null ? ` Reporting-site median ${fmt(c.benchMedian)} across ${n0(c.benchN)} sites in NAICS ${esc(c.benchCode || c.naics)}.` : '';
    return `<section class="sheet quiet"><p class="sheet-label">${esc(c.name)} · ${year} · ${esc(c.city)}, ${esc(c.st)} · ${n0(c.emp)} workers · NAICS ${esc(c.naics)}</p><div class="sheet-num"><span class="num">${fmt(c.trc)}</span><span class="pct">nonfatal cases per 100 full-time-equivalent workers</span></div>${deathsLine(c)}<p class="sheet-title">${basis || 'Rate not available'}${bench}</p><p class="sheet-text">DART ${fmt(c.dart)} · reported fatalities ${c.deaths == null ? 'not reported' : c.deaths}. ${status}${c.path ? 'The site page has the three-year record and the industry comparison.' : c.hasInd ? 'Sites under 250 workers have no page of their own; the industry page gives the comparison.' : 'Sites under 250 workers have no page of their own.'}</p><p class="sheet-actions">${c.path ? `<a class="next" href="${base}${esc(c.path)}">Site record & benchmark</a>` : c.hasInd ? `<a class="next" href="${base}industry/${esc(c.naics)}/">Industry benchmark</a>` : `<a class="next" href="${base}methodology/">How rates are computed</a>`}<a class="next" href="https://www.osha.gov/ords/imis/establishment.search?establishment=${encodeURIComponent(c.name)}&state=${encodeURIComponent(c.st)}" target="_blank" rel="noopener">OSHA inspections</a></p></section>`;
  }
  // company chosen: list its worksites (all sizes) from the member file, filtered by the optional place box
  async function paintMembers(c) {
    const box = $('co-sites'); if (!box) return;
    let ms; try { ms = await members(c.slug); } catch (e) { box.textContent = 'Worksite list could not be loaded.'; return; }
    const place = norm($('place')?.value || '');
    const rows = ms.filter(m => !place || (norm(m.city) + m.st.toLowerCase() + norm(m.name)).includes(place)).sort((a, b) => (b.emp || 0) - (a.emp || 0));
    const li = m => `<li><a href="${m.path ? base + esc(m.path) : base + 'company/' + esc(c.slug) + '/'}"><span class="nm">${esc(m.name)}<small class="rule">${esc(m.city)}, ${esc(m.st)} · ${n0(m.emp)} workers · ${m.status === 'included' ? 'included in rate' : m.status === 'screened_out' ? 'excluded by plausibility check' : 'missing fields'}</small></span><span class="meta"><b>TRC ${fmt(m.trc)}</b>${m.deaths ? `<small>${m.deaths} fatalit${m.deaths === 1 ? 'y' : 'ies'}</small>` : ''}</span></a></li>`;
    box.className = '';
    box.innerHTML = `<p class="muted small">${rows.length} of ${ms.length} matched worksites${place ? ' near “' + esc($('place').value.trim()) + '”' : ''}, largest first.</p><ul class="list fee">${rows.slice(0, 50).map(li).join('')}</ul>${rows.length > 50 ? `<p class="muted small">Showing 50 — download the full list below.</p>` : ''}`;
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
    if (nq.length < 2) { items = []; menu.innerHTML = '<li class="empty">Type at least two letters of the employer name.</li>'; menu.hidden = false; input.setAttribute('aria-expanded', 'true'); input.removeAttribute('aria-activedescendant'); return; }
    menu.innerHTML = '<li class="empty">Searching…</li>'; menu.hidden = false; input.setAttribute('aria-expanded', 'true'); say('Searching…', true);
    const place = norm($('place')?.value || '');
    let hits = [], cos = [], coFailed = false, estFailed = false;
    const render = () => {
      if (my !== seq) return;
      items = [...cos, ...hits.slice(0, 8 - cos.length)];
      const empty = coFailed && estFailed ? 'Search data could not be loaded. Please try again.' : 'No matching filing found in this search. Try the company name, the worksite\'s filed name, or a nearby city.';
      menu.innerHTML = (items.length ? items.map((c, i) => `<li role="option" id="q-option-${i}" data-i="${i}" aria-selected="${i === active}">${esc(c.name)}<small class="muted"> ${c.kind === 'co' ? `company · ${c.n} sites` : `${esc(c.city)}, ${esc(c.st)} · ${n0(c.emp)} workers`} · TRC ${fmt(c.trc)}${c.deaths ? ` · ${c.deaths} fatalit${c.deaths === 1 ? 'y' : 'ies'}` : ''}</small></li>`).join('') : `<li class="empty">${empty}</li>`) + (coFailed && !estFailed ? '<li class="empty">Company groups could not be loaded — worksite results are still available. <a href="#" id="retry-co">Retry company search</a></li>' : '');
      say(items.length ? `${cos.length} company group${cos.length === 1 ? '' : 's'} and ${items.length - cos.length} worksite${items.length - cos.length === 1 ? '' : 's'} shown.` : 'No matching results.');
      paintActive();
    };
    // company list and worksite shard load in parallel; whichever finishes first is shown first
    const first = norm(words[0] || '');
    const rest = words.slice(1).map(norm).filter(Boolean);
    const toks = words.map(norm).filter(Boolean);
    const coP = loadCompanies().then(list => { cos = list.filter(c => c.q.includes(nq) || toks.every(t => c.q.includes(t))).sort((a, b) => (b.q.includes(nq) - a.q.includes(nq)) || (b.emp || 0) - (a.emp || 0)).slice(0, 3); }).catch(() => { coFailed = true; }).then(render);
    const estP = shard((first + 'zz').slice(0, 2)).then(ests => { hits = ests.filter(e => e.q.startsWith(first) && rest.every(w => (e.q + norm(e.city) + e.st.toLowerCase() + e.co).includes(w)) && (!place || (norm(e.city) + e.st.toLowerCase()).includes(place))).sort((a, b) => (b.emp || 0) - (a.emp || 0)); }).catch(() => { estFailed = true; }).then(render);
    await Promise.all([coP, estP]);
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
  function writeResultUrl(c) {  // a result can be shared and reopened; sites under 250 workers have no page, so the URL is their only address
    const u = new URL(location.href); u.search = '';
    if (c.kind === 'co') u.searchParams.set('company', c.slug); else { u.searchParams.set('est', c.id); u.searchParams.set('shard', (c.q + 'zz').slice(0, 2)); }
    history.replaceState(null, '', u);
  }
  function choose(c) {
    input.value = c.name; close(); show(card(c)); writeResultUrl(c);
    if (c.kind === 'co') paintMembers(c);
    say(`${c.name}. ${year} nonfatal case rate ${fmt(c.trc)} per 100 full-time-equivalent workers${c.deaths ? `, ${c.deaths} reported fatalit${c.deaths === 1 ? 'y' : 'ies'}` : ''}.`);
    store.set('injuryrate.q', c.kind === 'co' ? ['co', c.slug] : ['est', c.id, (c.q + 'zz').slice(0, 2)]);
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
  menu.addEventListener('mousedown', e => { if (e.target.closest('li[data-i]')) e.preventDefault(); });
  menu.addEventListener('click', e => { if (e.target.id === 'retry-co') { e.preventDefault(); compReady = null; open(input.value); return; } const li = e.target.closest('li[data-i]'); if (!li) return; const it = items[+li.dataset.i]; if (it) choose(it); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  $('place')?.addEventListener('input', () => { if (input.value.trim()) open(input.value); const c = out.querySelector('#co-sites') && items.length === 0 ? null : null; });
  $('place')?.addEventListener('change', () => { const slug = new URLSearchParams(location.search).get('company'); if (slug && MEMBERS[slug]) paintMembers({ slug }); });
  // restore from the URL first (shared link), then from the last lookup
  const params = new URLSearchParams(location.search);
  let restored = null;
  try {
    if (params.get('company')) { restored = (await loadCompanies()).find(c => c.slug === params.get('company')); }
    else if (params.get('est')) { const key = params.get('shard'); if (!/^[a-z0-9]{2}$/.test(key || '')) throw new Error('Invalid search shard'); restored = (await shard(key)).find(e => e.id === params.get('est')); }
    if ((params.get('company') || params.get('est')) && !restored) show('<section class="sheet quiet"><p class="sheet-text">This filing is not available in the current data release.</p></section>');
  } catch (e) { }
  if (restored) choose(restored);
  const rem = store.get('injuryrate.q');
  let remembered = null;
  try {
    if (rem && rem[0] === 'co') { remembered = (await loadCompanies()).find(c => c.slug === rem[1]); }
    else if (rem && rem[0] === 'est') remembered = (await shard(rem[2])).find(e => e.id === rem[1]);
  } catch (e) { }
  if (remembered && !restored) { $('last-name').textContent = remembered.name; $('last').hidden = false; $('last').addEventListener('click', () => choose(remembered)); }
})();
