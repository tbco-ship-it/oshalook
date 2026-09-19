#!/usr/bin/env python3
"""Generate the static InjuryRate site into dist/ from data/site.json + data/shards/."""
import argparse
import datetime as dt
import hashlib
import json
import shutil
from pathlib import Path
from xml.sax.saxutils import escape

from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SITE = "InjuryRate"
SIZE = {"1": "under 20 employees", "2": "20–249 employees", "21": "20–99 employees", "22": "100–249 employees", "3": "250 or more employees"}


def fmt(n, dec=2):
    if n is None:
        return "Not available"
    return f"{n:,.{dec}f}" if isinstance(n, float) else f"{n:,}"


def verdict(rate, bench):
    """(class, label) comparing a TRC with the industry distribution."""
    if rate is None or not bench:
        return "quiet", "Not enough data"
    if rate == 0:
        return "quiet", "No nonfatal recordable cases reported"
    if rate <= bench["trc_med"]:
        return "quiet", "At or below the reporting-site median"
    if rate <= bench["trc_q3"]:
        return "quiet", "Above the reporting-site median"
    return "quiet", "Above the reporting-site 75th percentile"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="/oshalook/")
    ap.add_argument("--origin", default="https://tbco-ship-it.github.io")
    ap.add_argument("--cname", default="")
    ap.add_argument("--adsense-pub", default="pub-8425563704095379")
    args = ap.parse_args()
    base = args.base if args.base.endswith("/") else args.base + "/"
    origin = args.origin.rstrip("/")
    today = dt.date.today()

    d = json.loads((ROOT / "data/site.json").read_text())
    source, us, states, industries, companies, pages = d["source"], d["us"], d["states"], d["industries"], d["companies"], d["pages"]
    latest = str(source["latest"])
    years = [str(y) for y in source["years"]]
    by_id = {e["id"]: e for e in pages}
    for e in pages:
        y = e["years"][latest]
        e["cls"], e["label"] = verdict(y["trc"], e["bench"])
        e["size_label"] = SIZE.get(e["size"], "")
    for c in companies.values():
        c["path"] = f"company/{c['slug']}/"
        b = industries.get(c["naics"]) or d["prefix_bench"].get(c["naics"][:4]) or d["prefix_bench"].get(c["naics"][:3]) or d["prefix_bench"].get(c["naics"][:2])
        c["bench"] = b
        c["cls"], c["label"] = "quiet", "Combined rate for name-matched reporting sites"
        c["ests_all"] = [by_id[i] for i in c["est_ids"] if i in by_id]
        c["ests"] = c["ests_all"][:200]
        c["n_large_sites"] = len(c["ests_all"])
        c["included"] = c["by_year"].get(latest, {}).get("n", 0)
    for code, i in industries.items():
        i["path"] = f"industry/{code}/"
        i["ests"] = sorted([e for e in pages if e["naics"] == code and e["years"][latest]["ok"]], key=lambda e: -e["years"][latest]["emp"])[:60]
        i["companies"] = sorted([c for c in companies.values() if c["naics"] == code and c["emp"]], key=lambda c: -c["emp"])[:30]
    for st, s in states.items():
        s["path"] = f"state/{st.lower()}/"
        s["ests"] = sorted([e for e in pages if e["st"] == st and e["years"][latest]["ok"]], key=lambda e: -e["years"][latest]["emp"])[:80]
    big_companies = sorted(companies.values(), key=lambda c: -(c["emp"] or 0))
    rated = [c for c in companies.values() if c["trc"] is not None]  # groups with no rate-eligible filing keep their page and fatalities, but are not ranked
    worst_companies = sorted([c for c in rated if c["emp"] >= 5000], key=lambda c: -c["trc"])[:100]
    safest_companies = sorted([c for c in rated if c["emp"] >= 5000 and c["bench"]], key=lambda c: c["trc"])[:100]
    most_deaths = sorted([c for c in companies.values() if c["deaths"]], key=lambda c: -c["deaths"])[:100]
    ind_list = sorted(industries.values(), key=lambda i: -i["trc_med"])

    h = hashlib.md5()
    for f in sorted((ROOT / "static").glob("*")):
        h.update(f.read_bytes())
    h.update(str(source).encode())
    v = h.hexdigest()[:8]
    env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=select_autoescape(["html"]))
    env.filters["fmt"] = fmt
    env.globals.update(site=SITE, base=base, origin=origin, today=today.isoformat(), v=v, adsense_pub=args.adsense_pub, source=source, latest=latest, years=years,
                       us=us, states=states, industries=industries, companies=companies, n_pages=len(pages), n_filings=source["n_filings"], SIZE=SIZE)

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(ROOT / "static", DIST / "static")
    shutil.copytree(ROOT / "data/shards", DIST / "static/shards")
    shutil.copytree(ROOT / "data/company-sites", DIST / "static/company-sites")
    (DIST / "static/companies.json").write_text(json.dumps([[c["name"], c["slug"], c["n_est"], c["trc"], c["emp"], c["dart"], c["deaths"]] for c in big_companies], separators=(",", ":")))

    urls = []

    def write(path, template, **ctx):
        out = DIST / path
        out.mkdir(parents=True, exist_ok=True)
        (out / "index.html").write_text(env.get_template(template).render(path=path, **ctx))
        urls.append(path)

    write("", "index.html", big=big_companies[:10], worst=worst_companies[:8], ind_top=ind_list[:8])
    for page in ("about", "methodology", "privacy", "contact"):
        write(f"{page}/", f"{page}.html")
    chunks_c = [big_companies[i:i + 300] for i in range(0, len(big_companies), 300)]
    cpaths = ["companies/" if i == 0 else f"companies/page/{i + 1}/" for i in range(len(chunks_c))]
    for i, rows in enumerate(chunks_c):
        write(cpaths[i], "companies.html", rows=rows, page_no=i + 1, page_count=len(chunks_c), prev_path=cpaths[i - 1] if i else None, next_path=cpaths[i + 1] if i + 1 < len(cpaths) else None, offset=i * 300)
    write("industries/", "industries.html", rows=ind_list)
    write("states/", "states.html")
    write("rankings/highest-injury-rate/", "ranking.html", title=f"Large employers with the highest reported injury rates ({latest})", rows=worst_companies, kind="worst")
    write("rankings/lowest-injury-rate/", "ranking.html", title=f"Large employers with the lowest reported injury rates ({latest})", rows=safest_companies, kind="safest")
    write("rankings/most-fatalities/", "ranking.html", title=f"Companies reporting the most workplace fatalities ({latest})", rows=most_deaths, kind="deaths")
    write("guide/trc-dart/", "guide_trc.html")
    write("guide/check-a-company/", "guide_check.html")
    for c in companies.values():
        write(c["path"], "company.html", c=c)
    for i in industries.values():
        write(i["path"], "industry.html", i=i)
    for s in states.values():
        write(s["path"], "state.html", s=s)
    for e in pages:
        i = industries.get(e["naics"])
        c = companies.get(e["company_slug"]) if e["company_slug"] else None
        write(e["path"], "establishment.html", e=e, i=i, c=c)

    chunks = [urls[i:i + 40000] for i in range(0, len(urls), 40000)]
    names = []
    for i, ch in enumerate(chunks):
        name = "sitemap.xml" if len(chunks) == 1 else f"sitemap-{i + 1}.xml"
        names.append(name)
        (DIST / name).write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(f"<url><loc>{escape(origin + base + u)}</loc></url>" for u in ch) + "\n</urlset>")
    if len(chunks) > 1:
        (DIST / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<sitemap><loc>{origin}{base}{n}</loc></sitemap>" for n in names) + "</sitemapindex>")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {origin}{base}sitemap.xml\n")
    (DIST / "404.html").write_text(env.get_template("404.html").render(path="404"))
    (DIST / ".nojekyll").write_text("")
    key = (ROOT / "static/indexnow-key.txt").read_text().strip()
    (DIST / f"{key}.txt").write_text(key + "\n")
    if args.adsense_pub:
        (DIST / "ads.txt").write_text(f"google.com, {args.adsense_pub}, DIRECT, f08c47fec0942fa0\n")
    if args.cname:
        (DIST / "CNAME").write_text(args.cname + "\n")
    print(f"built {len(urls)} pages ({len(pages)} establishments, {len(companies)} companies, {len(industries)} industries) -> {DIST}")


if __name__ == "__main__":
    main()
