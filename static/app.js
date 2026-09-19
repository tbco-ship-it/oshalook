(async function () {
  const cssHref = document.querySelector('link[href*="static/style.css"]').getAttribute('href');
  const v = (cssHref.match(/\?v=([^&]+)/) || [])[1] || '';
  const base = cssHref.replace(/static\/style\.css.*$/, '');
  const $ = id => document.getElementById(id);
  const input = $('q'); if (!input) return;
  const out = $('result'), menu = $('q-menu');
  const fmt = n => n == null ? '—' : (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Normalization mirrors scripts/normalize.py norm_name(): drop Inc/LLC/Corp… and non-alphanumerics.
  const norm = s => (s || '').toLowerCase().replace(/\b(inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|lp|l\.p|plc|the)\b\.?/g, ' ').replace(/[^a-z0-9]/g, '');
  // Companies list (8k rows) loads up front; establishment shards (~1,100 files keyed by the first two letters) load on demand.
  let COMP = [];
  try { COMP = (await (await fetch(base + 'static/companies.json?v=' + v)).json()).map(a => ({ kind: 'co', name: a[0], slug: a[1], n: a[2], trc: a[3], emp: a[4], q: norm(a[0]) })); } catch (e) { }
  const SH = {};
  async function shard(k) {
    if (SH[k]) return SH[k];
    try { const r = await fetch(base + `static/shards/${k}.json?v=` + v); SH[k] = r.ok ? (await r.json()).map(a => ({ kind: 'est', id: a[0], name: a[1], city: a[2], st: a[3], naics: a[4], emp: a[5], trc: a[6], dart: a[7], deaths: a[8], path: a[9], co: a[10], q: norm(a[1]) })) : []; }
    catch (e) { SH[k] = []; }
    return SH[k];
  }
  let items = [], active = -1, seq = 0;
  function card(c) {
    if (c.kind === 'co') return `<section class="sheet ${c.trc == null ? 'quiet' : 'balanced'}"><p class="sheet-label">Company · ${c.n} filing sites · ${c.emp.toLocaleString('en-US')} workers</p><div class="sheet-num"><span class="num">${fmt(c.trc)}</span><span class="pct">TRC</span></div><p class="sheet-title">${c.name}</p><p class="sheet-text">Hours-weighted recordable case rate across all sites that filed Form 300A. The company page compares it with the industry median and lists every large site.</p><p class="sheet-actions"><a class="next" href="${base}company/${c.slug}/">Company record & sites</a></p></section>`;
    const cls = c.trc == null ? 'quiet' : c.trc === 0 ? 'balanced' : c.trc > 6 ? 'severe' : c.trc > 3 ? 'mild' : 'balanced';
    return `<section class="sheet ${cls}"><p class="sheet-label">${c.city}, ${c.st} · ${c.emp.toLocaleString('en-US')} workers · NAICS ${c.naics}</p><div class="sheet-num"><span class="num">${fmt(c.trc)}</span><span class="pct">TRC</span></div><p class="sheet-title">${c.name}</p><p class="sheet-text">DART ${fmt(c.dart)}${c.deaths ? ` · <b>${c.deaths} death${c.deaths === 1 ? '' : 's'}</b>` : ''}${c.trc == null ? ' · hours or headcount in the filing look implausible, so no rate' : ''}. Compare with the industry median on the ${c.path ? 'site page' : 'industry page'}.</p><p class="sheet-actions">${c.path ? `<a class="next" href="${base}${c.path}">Site record, 3-year trend & benchmark</a>` : `<a class="next" href="${base}industry/${c.naics}/">Industry benchmark</a>`}<a class="next" href="https://www.osha.gov/ords/imis/establishment.search?establishment=${encodeURIComponent(c.name)}&state=${c.st}" target="_blank" rel="noopener">OSHA inspections</a></p></section>`;
  }
  async function open(q) {
    const my = ++seq;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const nq = norm(q);
    if (nq.length < 2) { items = []; menu.innerHTML = '<li class="empty">Type at least two letters of the employer name.</li>'; menu.hidden = false; return; }
    const cos = COMP.filter(c => c.q.includes(nq)).slice(0, 3);
    const first = norm(words[0]);
    const ests = (await shard((first + 'zz').slice(0, 2))); if (my !== seq) return;
    const rest = words.slice(1).map(norm).filter(Boolean);
    const hits = ests.filter(e => e.q.startsWith(first) && rest.every(w => (e.q + norm(e.city) + e.st.toLowerCase() + e.co).includes(w))).sort((a, b) => b.emp - a.emp).slice(0, 8 - cos.length);
    items = [...cos, ...hits];
    menu.innerHTML = items.length ? items.map((c, i) => `<li role="option" data-i="${i}" ${i === active ? 'aria-selected="true"' : ''}>${c.name}<small class="muted"> ${c.kind === 'co' ? `company · ${c.n} sites` : `${c.city}, ${c.st} · ${c.emp.toLocaleString('en-US')} workers`} · TRC ${fmt(c.trc)}</small></li>`).join('') : '<li class="empty">No filing by that name. Establishment names are as the employer typed them — try a shorter form.</li>';
    menu.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function close() { menu.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); }
  function leaveLanding() {
    const html = document.documentElement; if (!html.classList.contains('landing')) return;
    const stage = $('stage'), hero = stage.firstElementChild;
    const y0 = hero.getBoundingClientRect().top;
    html.classList.remove('landing');
    const dy = y0 - hero.getBoundingClientRect().top;
    if (dy > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stage.style.transition = 'none'; stage.style.transform = `translateY(${dy}px)`; void stage.offsetHeight;
      stage.style.transition = 'transform 1s cubic-bezier(.16,1,.3,1)'; stage.style.transform = 'translateY(0)';
      stage.addEventListener('transitionend', () => { stage.style.transition = ''; stage.style.transform = ''; }, { once: true });
    }
    if (window.__reveal) window.__reveal($('below'), true, 500);
  }
  function show(html) {
    leaveLanding(); out.innerHTML = html;
    out.classList.remove('is-in'); out.classList.add('reveal');
    let i = 0; out.querySelectorAll(':scope > *').forEach(c => { [c, ...c.children].forEach(el => { el.classList.add('rv'); el.style.setProperty('--d', (i++ * 45) + 'ms'); }); });
    void out.offsetHeight; out.classList.add('is-in');
  }
  function choose(c) {
    input.value = c.name; close(); show(card(c));
    localStorage.setItem('injuryrate.q', JSON.stringify(c.kind === 'co' ? ['co', c.slug] : ['est', c.id, (c.q + 'zz').slice(0, 2)]));
    if (innerWidth < 900) setTimeout(() => out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 60);
  }
  input.addEventListener('focus', () => { setTimeout(() => input.select(), 0); open(input.value); });
  input.addEventListener('input', () => { active = -1; open(input.value); });
  input.addEventListener('keydown', e => {
    if (menu.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); open(input.value); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); open(input.value); e.preventDefault(); }
    else if (e.key === 'Enter') { const it = items[active >= 0 ? active : 0]; if (it) choose(it); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  menu.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { choose(items[+li.dataset.i]); e.preventDefault(); } });
  input.addEventListener('blur', () => setTimeout(close, 120));
  const rem = JSON.parse(localStorage.getItem('injuryrate.q') || 'null');
  let remembered = null;
  if (rem && rem[0] === 'co') remembered = COMP.find(c => c.slug === rem[1]);
  else if (rem && rem[0] === 'est') remembered = (await shard(rem[2])).find(e => e.id === rem[1]);
  if (remembered) { $('last-name').textContent = remembered.name; $('last').hidden = false; $('last').addEventListener('click', () => choose(remembered)); }
})();
