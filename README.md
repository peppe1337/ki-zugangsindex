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
providers. Aggregate numbers exist too, and it is worth being precise about what they already
cover:

- [Originality.ai](https://originality.ai/ai-bot-blocking) has tracked GPTBot blocking across
  the **global top 1000** since August 2023 — 5% then, 35.7% by August 2024. Not broken down by
  language.
- The Reuters Institute measured the **15 most-used news sites** in each of ten countries,
  Germany included, for 2023
  ([Fletcher, 2024](https://reutersinstitute.politics.ox.ac.uk/how-many-news-websites-block-ai-crawlers)).
  A one-off snapshot, and news publishers only.

So a German figure does exist. What does not is a German panel that reaches past news
publishers and past the top ranks, and that gets re-run on the same domains. The 300
