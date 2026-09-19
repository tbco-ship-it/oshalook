# InjuryRate — OSHA Form 300A injury rates by employer

Static site. Source: OSHA ITA 300A summary CSVs 2023–2025 (osha.gov/itadata; data/raw/, 250 MB, download via a browser session — osha.gov blocks curl for the zips). Rates per OSHA/BLS definitions; benchmarks per NAICS from the filings.

```
../martday/.venv/bin/python scripts/normalize.py   # -> data/site.json + data/shards/*.json (search)
../martday/.venv/bin/python scripts/build.py --base / --origin https://<domain> --cname <domain>
```
