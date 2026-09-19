#!/usr/bin/env python3
"""OSHA ITA Form 300A summary data (data/raw/ITA_300A_<year>.csv, osha.gov/itadata) -> data/site.json + data/shards/
TRC  = (days-away + restricted/transfer + other recordable cases) x 200,000 / hours worked   (cases per 100 FTE)
DART = (days-away + restricted/transfer cases)                    x 200,000 / hours worked
Pages: establishments with >= 250 average employees in the latest year (3-year history), companies with >= 5 filing
establishments, NAICS industries (benchmarks computed from the filings themselves), states. Every establishment is
searchable through name shards."""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw"
YEARS = [2023, 2024, 2025]
LATEST = YEARS[-1]
MIN_EMP_PAGE = 250
MIN_EST_COMPANY = 5
MIN_N_BENCH = 20
SIZE = {"1": "<20 employees", "2": "20–249 employees", "21": "20–99 employees", "22": "100–249 employees", "3": "250+ employees"}
STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico", "GU": "Guam", "VI": "U.S. Virgin Islands", "AS": "American Samoa", "MP": "Northern Mariana Islands"}


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def slug(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-") or "x"


def norm_name(s):
    s = (s or "").lower()
    s = re.sub(r"\b(inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|lp|l\.p|plc|the)\b\.?", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def rates(r):
    hrs = num(r["total_hours_worked"])
    dafw, djtr, other, deaths = num(r["total_dafw_cases"]), num(r["total_djtr_cases"]), num(r["total_other_cases"]), num(r["total_deaths"])
    cases = dafw + djtr + other
    emp = num(r["annual_average_employees"])
    # drop nonsense filings: hours per employee outside 300–4,000 (typo'd hours are the #1 error in ITA data), more cases than 2x headcount
    ok = emp > 0 and 300 <= hrs / emp <= 4000 and cases <= emp * 2
    return {"hrs": hrs, "emp": num(r["annual_average_employees"]), "dafw": dafw, "djtr": djtr, "other": other, "deaths": deaths, "cases": cases,
            "dafw_days": num(r["total_dafw_days"]), "djtr_days": num(r["total_djtr_days"]), "injuries": num(r["total_injuries"]),
            "trc": round(cases * 200000 / hrs, 2) if ok else None, "dart": round((dafw + djtr) * 200000 / hrs, 2) if ok else None, "ok": ok}


def main():
    by_id = {}
    for y in YEARS:
        with open(RAW / f"ITA_300A_{y}.csv", encoding="utf-8", errors="replace") as fh:
            for r in csv.DictReader(fh):
                eid = r["establishment_id"].strip()
                if not eid:
                    continue
                e = by_id.setdefault(eid, {"id": eid, "years": {}})
                e["years"][y] = rates(r)
                if y == LATEST or "name" not in e:  # latest filing wins for identity fields
                    e.update({"name": re.sub(r"\s+", " ", r["establishment_name"]).strip(), "company": re.sub(r"\s+", " ", r["company_name"] or "").strip(),
                              "street": r["street_address"].strip(), "city": r["city"].strip().title(), "st": r["state"].strip().upper(), "zip": r["zip_code"].strip()[:5],
                              "naics": r["naics_code"].strip()[:6], "industry": r["industry_description"].strip(), "size": r["size"].strip(), "ein": r["ein"].strip()})
    ests = [e for e in by_id.values() if LATEST in e["years"]]
    print(f"{len(by_id)} establishments seen, {len(ests)} filed for {LATEST}")
    # industry benchmarks from the latest year: median + quartiles of TRC/DART where enough filings
    ind = defaultdict(list)
    ind_name = {}
    for e in ests:
        yv = e["years"][LATEST]
        if yv["ok"] and e["naics"]:
            ind[e["naics"]].append(yv)
            ind_name.setdefault(e["naics"], e["industry"])

    def bench(vals):
        t = sorted(v["trc"] for v in vals); d = sorted(v["dart"] for v in vals)
        q = lambda a, p: a[min(len(a) - 1, int(len(a) * p))]
        return {"n": len(vals), "trc_med": round(median(t), 2), "trc_q1": round(q(t, .25), 2), "trc_q3": round(q(t, .75), 2), "dart_med": round(median(d), 2), "dart_q3": round(q(d, .75), 2),
                "deaths": sum(v["deaths"] for v in vals), "cases": sum(v["cases"] for v in vals), "hrs": sum(v["hrs"] for v in vals),
                "trc_pooled": round(sum(v["cases"] for v in vals) * 200000 / max(1, sum(v["hrs"] for v in vals)), 2),
                "dart_pooled": round(sum(v["dafw"] + v["djtr"] for v in vals) * 200000 / max(1, sum(v["hrs"] for v in vals)), 2)}
    industries = {}
    for code, vals in ind.items():
        if len(vals) >= MIN_N_BENCH:
            industries[code] = {"code": code, "name": ind_name[code], **bench(vals)}
    # fallback benchmark by NAICS prefix (4, 3, 2 digits)
    prefix = defaultdict(list)
    for code, vals in ind.items():
        for k in (4, 3, 2):
            prefix[code[:k]].extend(vals)
    prefix_bench = {p: bench(v) for p, v in prefix.items() if len(v) >= MIN_N_BENCH}

    def bench_for(naics):
        if naics in industries:
            return naics, industries[naics]
        for k in (4, 3, 2):
            if naics[:k] in prefix_bench:
                return naics[:k], prefix_bench[naics[:k]]
        return None, None
    # companies
    comp = defaultdict(list)
    for e in ests:
        k = norm_name(e["company"] or e["name"])
        if k:
            comp[k].append(e)
    companies = {}
    for k, lst in comp.items():
        if len(lst) < MIN_EST_COMPANY:
            continue
        vals = [e["years"][LATEST] for e in lst if e["years"][LATEST]["ok"]]
        if not vals:
            continue
        name = max((e["company"] or e["name"] for e in lst), key=lambda s: sum(1 for e in lst if (e["company"] or e["name"]) == s))
        cs = slug(name)
        n = 2
        while cs in companies:
            cs = f"{slug(name)}-{n}"; n += 1
        b = bench(vals)
        top_naics = max(set(e["naics"] for e in lst), key=lambda c: sum(1 for e in lst if e["naics"] == c))
        by_year = {}
        for y in YEARS:
            yv = [e["years"][y] for e in lst if y in e["years"] and e["years"][y]["ok"]]
            if yv:
                by_year[y] = {"n": len(yv), "trc": round(sum(v["cases"] for v in yv) * 200000 / sum(v["hrs"] for v in yv), 2), "dart": round(sum(v["dafw"] + v["djtr"] for v in yv) * 200000 / sum(v["hrs"] for v in yv), 2), "deaths": sum(v["deaths"] for v in yv), "cases": sum(v["cases"] for v in yv), "emp": sum(v["emp"] for v in yv)}
        companies[cs] = {"slug": cs, "name": name, "key": k, "n_est": len(lst), "naics": top_naics, "industry": ind_name.get(top_naics, lst[0]["industry"]), "states": sorted({e["st"] for e in lst}),
                         "trc": b["trc_pooled"], "dart": b["dart_pooled"], "deaths": b["deaths"], "cases": b["cases"], "emp": sum(v["emp"] for v in vals), "by_year": by_year,
                         "est_ids": [e["id"] for e in sorted(lst, key=lambda e: -(e["years"][LATEST]["emp"]))]}
    comp_slug_by_key = {c["key"]: c["slug"] for c in companies.values()}
    # establishment pages
    pages = []
    used = {}
    for e in ests:
        yv = e["years"][LATEST]
        if yv["emp"] < MIN_EMP_PAGE:
            continue
        s = f"{e['st'].lower()}/{slug(e['name'])}-{slug(e['city'])}"
        n = used.get(s, 0) + 1
        used[s] = n
        e["path"] = (s if n == 1 else f"{s}-{n}") + "/"
        bcode, b = bench_for(e["naics"])
        e["bench_code"], e["bench"] = bcode, b
        e["company_slug"] = comp_slug_by_key.get(norm_name(e["company"] or e["name"]))
        pages.append(e)
    page_ids = {e["id"] for e in pages}
    # name shards for the full set (search): key = first two chars of normalized name
    shards = defaultdict(list)
    for e in ests:
        yv = e["years"][LATEST]
        k = (norm_name(e["name"]) + "zz")[:2]
        shards[k].append([e["id"], e["name"], e["city"], e["st"], e["naics"], yv["emp"], yv["trc"], yv["dart"], yv["deaths"], e["path"] if e["id"] in page_ids else "", norm_name(e["company"])[:24]])
    sd = ROOT / "data/shards"
    sd.mkdir(exist_ok=True)
    for f in sd.glob("*.json"):
        f.unlink()
    for k, rows in shards.items():
        (sd / f"{k}.json").write_text(json.dumps(rows, separators=(",", ":")))
    # states
    states = {}
    for e in ests:
        if e["st"] in STATES:
            states.setdefault(e["st"], []).append(e["years"][LATEST])
    state_bench = {st: {"st": st, "name": STATES[st], **bench([v for v in vals if v["ok"]])} for st, vals in states.items() if sum(1 for v in vals if v["ok"]) >= MIN_N_BENCH}
    us = bench([e["years"][LATEST] for e in ests if e["years"][LATEST]["ok"]])
    out = {"source": {"name": "OSHA Injury Tracking Application, Form 300A summary data", "url": "https://www.osha.gov/itadata", "years": YEARS, "latest": LATEST, "fetched": "2026-09-19", "n_filings": len(ests)},
           "us": us, "states": state_bench, "industries": industries, "prefix_bench": prefix_bench, "companies": companies,
           "pages": [{k: e[k] for k in ("id", "name", "company", "street", "city", "st", "zip", "naics", "industry", "size", "years", "path", "bench_code", "bench", "company_slug")} for e in pages]}
    (ROOT / "data/site.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"pages {len(pages)}, companies {len(companies)}, industries {len(industries)}, states {len(state_bench)}, shards {len(shards)}; US TRC {us['trc_med']} med / {us['trc_pooled']} pooled")


if __name__ == "__main__":
    main()
