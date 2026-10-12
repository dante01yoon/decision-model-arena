# Decision Model Arena

[한국어](README.ko.md) · Video: https://youtu.be/gJgY5NvBcBk · Short: https://youtube.com/shorts/taS6Smj8YxA

Four **decision models** — models that answer with probabilities over options instead of writing text — play the same games and answer the same questions:

| Model | Provider | How it is called here |
|---|---|---|
| **Decisions API** (`gpt-6-luna`) | OpenAI | `POST https://api.openai.com/v1/decisions` (adapter in `server.py`) |
| **Decision-1** (`microsoft/microsoft-decision-1`) | Microsoft | `POST https://openrouter.ai/api/alpha/decisions` |
| **Jev** (`jev-latest`) | TypeSafe | `POST https://api.typesafe.ai/v1/systemone` |
| **Laya** (`convaiinnovations/laya`) | open weights | runs locally (Apple Silicon MPS) |

Every side receives the same state and the same named questions (`choice` / `noul` / `score`). Code owns every rule and every number (legal moves, blast lines, escape routes); the model only makes the judgement call each turn.

## Results (measured 2026-10-12, called from the US — your numbers will differ)

| | Versus Tetris (48 games) | Bomb battle (12 four-player games) | Reads images | p50 latency | Cost per 10k decisions |
|---|---|---|---|---|---|
| Decision-1 | **15 wins** | 3 | no | 300 ms | $0.15 |
| Jev | 12 | 4 | no (text only) | 168 ms | $0.29 |
| Decisions API | 11 | **5** | **yes** | 158 ms | $0.71 |
| Laya | 8 | 0 (self-destructed in all 12) | no (text only) | 103 ms | $0 |

- Head-to-head, Tetris: see `evidence/league.json`. Laya tied Jev 4–4; Decisions API cleared the most lines but lost to Jev 2–6.
- Bomb battle: Decisions API was the only model to eliminate opponents (5), but also blew itself up 6 times; 3 of its 5 wins were simultaneous eliminations decided on score.
- **Images.** Decisions API accepts images. Decision-1 is not listed as image-capable on OpenRouter; when an `image_url` part is sent anyway it still answers, but counts the base64 as text (one photo ≈ 15,406 input tokens vs 1,331 on OpenAI) and follows the caption only: with the caption "a delivery box photo" it answered "delivery box" for a blank gray image, a login page and a game picture (`evidence/vision/trick.json`, `evidence/vision/d1-image-probe.json`).
- **Text vs picture Tetris** (same Decisions API, 8 games): reading the state as text won 5, seeing only a picture of both boards won 3, at almost the same latency (`evidence/vision-tetris.json`).

Test images: the delivery-box photos were generated with an image model; the bank pages are a fictional bank ("도토리은행") built in `arena/vision/img/login-*.html`.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install laya   # Laya; Apple Silicon recommended
cp .env.example .env                                   # add TYPESAFE_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY
.venv/bin/python arena/server.py 8750
```

Pages (Chrome, 1920×1080 layouts; add `&v=1` on `vision`/`results` for a 1080×1920 layout):

| Page | URL |
|---|---|
| Same question to all four | `http://localhost:8750/ask/?state=...&question=...&choices=결제|배송|기타` |
| Versus Tetris (any two) | `http://localhost:8750/match/?a=jev&b=d1&seed=42` |
| Text vs picture Tetris | `http://localhost:8750/match/?a=openai-text&b=openai-vision&seed=42` |
| Four-player bomb battle | `http://localhost:8750/bomb/?seed=105&order=laya,jev,openai,d1` |
| Image decisions | `http://localhost:8750/vision/?case=box` (`box`, `login`, `trick`, `bombshot`, `thumb`) |
| Result charts | `http://localhost:8750/results/?view=tetris` (`h2h`, `bomb`, `vision`, `speed`, `recap`) |

Headless leagues (Node 18+; server must be running):

```bash
node measure/tournament.mjs league 3 7 11 19 23 42 57 88        # round-robin Tetris → evidence/league.json
node measure/bomb-league.mjs bomb-league 101 102 103 104 105 106 107 108 109 110 111 112
```

Every API call is appended to `evidence/calls.jsonl` (latency, usage, cost, answers). The calls behind the published numbers are in `evidence/calls.jsonl.gz`.

## Cost of the whole experiment

Prices used: Decisions API $0.10 / 1M input tokens, Decision-1 $0.042 / 1M (OpenRouter reports the cost per call), Jev $0.042 / 1M; no output charges. All 16,768 calls behind the leagues, demos and image tests cost about **$0.61** in total (Decisions API $0.42, Jev $0.12, Decision-1 $0.07, Laya $0).

## Notes

- Results depend on prompts, game design, region and date. Decision-1 went through OpenRouter (provider: Azure), not Foundry directly.
- API keys stay in the server process; the browser never sees them.
- The Tetris engine started from [laya-jev-arena](https://github.com/dante01yoon/laya-jev-arena).

License: MIT
