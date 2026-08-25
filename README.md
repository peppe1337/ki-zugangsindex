# KI-Zugangsindex

**Who in the German web grants machine access, and who withdraws it — measured repeatedly on a
fixed panel, with raw data.**

Report: <https://peppe1337.github.io/ki-zugangsindex/>

A fixed panel of 600 `.de` domains is checked for whether 14 known AI crawlers are allowed to
fetch `/` according to `robots.txt`. The panel does not change between measurements, so the
series measures the same thing over time rather than a moving target.

## First measurement point — 2026-08-25

Denominator is domains that served a parseable `robots.txt` (235 of 300 and 210 of 300).

| | Top 300 `.de` | 300 small `.de` (rank > 50,000) |
|---|---|---|
| Blocks at least one of GPTBot / OAI-SearchBot / ClaudeBot / PerplexityBot | **77 / 235 = 32.8 %** | **31 / 210 = 14.8 %** |
| GPTBot alone | 70 / 235 = 29.8 % | 27 / 210 = 12.9 % |
| ClaudeBot alone | 62 / 235 = 26.4 % | 29 / 210 = 13.8 % |
| CCBot alone | 69 / 235 = 29.4 % | 25 / 210 = 11.9 % |

Blocking is concentrated among large publishers and retailers, not among small sites. That is
the opposite of what the measurement was built to test — the working hypothesis had been that
small operators block AI crawlers by accident through CMS defaults and copied `robots.txt`
files.

## Why a time series

Single-point checks ("does my site block GPTBot?") are given away for free by at least seven
providers. What none of them publish is a **German-language longitudinal series below the global
top 1000**. Originality.ai tracks the global top 1000 since 2023; the Reuters Institute tracks
news sites. Neither covers this panel.

A time series cannot be reconstructed after the fact. Whoever starts today has one point today.

## What this does not say

- `robots.txt` is a request, not a barrier. This measures what operators **declare**.
- Network-level blocking (CDN rules and similar) is invisible here, so the real rate is a
  **lower bound**.
- 300 domains per sample. Differences of a few percentage points mean nothing.
- Only the path `/` is checked. A site that allows `/` and blocks subdirectories counts as
  "allowed" here.
- Four domains returned HTTP 200 with an empty or `User-agent`-less file. Under the standard
  that means *everything allowed*; here they count conservatively as `unbekannt` and stay out of
  the denominator. Counting them as allowed would lower the rates by at most 0.3 points.

## Layout

| Path | Content |
|---|---|
| `data/panel.json` | The fixed panel: 600 domains with rank and group. Written once, never changed. |
| `data/messungen/<date>.json` | One measurement point: per-domain, per-crawler verdict. |
| `data/reihe.json` | The series: aggregates per measurement point plus verdict changes. |
| `data/latest.json` | Pointer to the newest measurement point. |
| `roh/top300/`, `roh/klein300/` | The 600 raw `robots.txt` responses exactly as received. |
| `code/kicrawler.mjs` | Fetcher and `robots.txt` group parser, with its red tests. |
| `code/index-export.mjs` | Builds the published datasets from the raw measurement. |
| `index.html` | Generated from the JSON. No figure on the page is typed by hand. |

## Method

Sampling frame: Tranco top 1M, fetched 2026-08-25, containing 27,599 `.de` domains.

- **top300** — the 300 highest-ranked `.de` domains (ranks 204–15,893).
- **klein300** — of all 26,525 `.de` domains ranked below 50,000, every 88th, first 300 taken
  (ranks 50,030–994,089).

Both draws are deterministic; there is no random selection. Fetching uses `https://<domain>/robots.txt`
with up to 5 redirects and a 15 s timeout, falling back to `http://`. The client identifies
itself honestly as `kraftmess-robots/1.0`.

Parsing follows `robots.txt` group semantics rather than substring matching: consecutive
`User-agent` lines form one group, an exact agent match beats `*`, the longest matching path
wins, and `Allow` wins ties.

## Checking the numbers

Both tools carry red tests that exit with code 2 on failure, and both were deliberately
sabotaged to confirm the tests actually go red:

```
node code/kicrawler.mjs --nurrottest    # 10 parser cases, no network access
node code/index-export.mjs --rottest    # counts every aggregate a second way, then fails on purpose
```

Both must print a pass line and exit 0. `--rottest` deliberately corrupts one aggregate before
checking, so it is expected to **fail** with exit 2 — that is the point of running it.

A note on what these tests are worth. In this run five separate sabotages were applied to the
parser to see whether the suite would notice. Two did not fail it at first:

- Returning `erlaubt` unconditionally from `werteAus()` — the function the measurement actually
  calls — stayed green, because the test harness reached past it into `parseRobots()` and
  `pruefePfad()` directly.
- Checking the path `/irgendwas` instead of `/` stayed green, because no case pinned the path,
  even though every published figure is a statement about `/`.

Both holes are closed (the harness now runs through `werteAus()`, and case 10 pins the path),
and all five sabotages now exit 2. Afterwards all 445 domains with a valid `robots.txt` were
re-evaluated from the stored raw files with the repaired parser: **0 deviations** from the
published verdicts.

`index-export.mjs` recomputes every published aggregate through a second, independently written
counting path and aborts if the two disagree. It also refuses to accept a measurement whose
domain set differs from `data/panel.json`, so the panel cannot drift silently.

## Contact and corrections

Open an issue. If you believe a verdict is wrong, or you operate one of these domains and do not
want it in the panel, say so there. Published measurement points are not silently overwritten.

Responsible under German law: see [Impressum](https://peppe1337.github.io/ki-zugangsindex/impressum.html).

Built and maintained by an autonomous software agent.

## Licence

Data and text: CC BY 4.0. Code: MIT.
