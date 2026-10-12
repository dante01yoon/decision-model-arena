# Decision Model Arena (판단 AI 4파전)

[English](README.md) · 영상: https://youtu.be/gJgY5NvBcBk · 쇼츠: https://youtube.com/shorts/taS6Smj8YxA

글 대신 보기마다 확률로 답하는 **판단 모델** 네 개에게 같은 게임과 같은 질문을 시킵니다.

| 모델 | 회사 | 호출 방법 |
|---|---|---|
| **Decisions API** (`gpt-6-luna`) | OpenAI | `POST https://api.openai.com/v1/decisions` (`server.py`에서 형식 변환) |
| **Decision-1** (`microsoft/microsoft-decision-1`) | Microsoft | `POST https://openrouter.ai/api/alpha/decisions` |
| **Jev** (`jev-latest`) | TypeSafe | `POST https://api.typesafe.ai/v1/systemone` |
| **Laya** (`convaiinnovations/laya`) | 공개 가중치 | 내 맥에서 실행 (Apple Silicon MPS) |

모든 모델이 같은 상황 설명과 같은 질문(`choice`·`noul`·`score`)을 받습니다. 규칙과 숫자 계산(놓을 자리, 폭발 범위, 도망 경로)은 코드가 하고, 모델은 매 턴 판단만 합니다.

## 결과 (2026-10-12, 미국에서 호출 — 환경에 따라 달라집니다)

| | 테트리스 48경기 | 폭탄 대전 12판(4인) | 사진 판단 | 응답 시간 중앙값 | 판단 1만 번 비용 |
|---|---|---|---|---|---|
| Decision-1 | **15승** | 3승 | 못 봄 | 300ms | $0.15 |
| Jev | 12승 | 4승 | 글만 | 168ms | $0.29 |
| Decisions API | 11승 | **5승** | **봄** | 158ms | $0.71 |
| Laya | 8승 | 0승(12판 모두 자폭) | 글만 | 103ms | 0원 |

- 상대 전적은 `evidence/league.json`. Laya와 Jev는 4승 4패, Decisions API는 줄은 가장 많이 지웠지만 Jev에게 2승 6패.
- 폭탄 대전: 상대를 탈락시킨 건 Decisions API뿐(5번)이고 자폭도 6번. 5승 중 3판은 동시 탈락 후 점수 승.
- **사진.** Decisions API는 이미지를 받습니다. Decision-1은 OpenRouter 이미지 지원 목록에 없고, `image_url`을 넣으면 답은 오지만 base64를 글자로 셉니다(사진 한 장 입력 15,406토큰, OpenAI는 1,331토큰). 설명에 "택배 상자 사진"이라고 쓰고 회색 빈 사진·로그인 화면·게임 그림을 보내면 셋 다 "택배 상자"라고 답했습니다(`evidence/vision/trick.json`, `evidence/vision/d1-image-probe.json`).
- **글 vs 그림 테트리스**(같은 Decisions API, 8경기): 글로 읽은 쪽 5승, 보드 그림만 본 쪽 3승, 응답 시간은 거의 같음(`evidence/vision-tetris.json`).

시험 이미지: 택배 사진은 이미지 생성 모델로 만든 것이고, 은행 화면은 가상의 '도토리은행'으로 직접 만든 화면입니다(`arena/vision/img/login-*.html`).

## 실행

```bash
python3 -m venv .venv && .venv/bin/pip install laya   # Laya (Apple Silicon 권장)
cp .env.example .env                                   # TYPESAFE_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY 입력
.venv/bin/python arena/server.py 8750
```

| 화면 | 주소 |
|---|---|
| 같은 질문을 넷에게 | `http://localhost:8750/ask/?state=...&question=...&choices=결제|배송|기타` |
| 테트리스 대전(둘 고르기) | `http://localhost:8750/match/?a=jev&b=d1&seed=42` |
| 글 vs 그림 테트리스 | `http://localhost:8750/match/?a=openai-text&b=openai-vision&seed=42` |
| 4인 폭탄 대전 | `http://localhost:8750/bomb/?seed=105&order=laya,jev,openai,d1` |
| 사진 판단 | `http://localhost:8750/vision/?case=box` (`box`, `login`, `trick`, `bombshot`, `thumb`) |
| 결과 차트 | `http://localhost:8750/results/?view=tetris` (`h2h`, `bomb`, `vision`, `speed`, `recap`) |

`vision`, `results`는 `&v=1`을 붙이면 세로(1080×1920) 화면이 됩니다.

헤드리스 리그(Node 18+, 서버 실행 중):

```bash
node measure/tournament.mjs league 3 7 11 19 23 42 57 88
node measure/bomb-league.mjs bomb-league 101 102 103 104 105 106 107 108 109 110 111 112
```

모든 호출은 `evidence/calls.jsonl`에 지연·사용량·비용·답과 함께 쌓이고, 공개한 숫자의 원본 호출은 `evidence/calls.jsonl.gz`에 있습니다.

## 비용

Decisions API 입력 100만 토큰당 $0.10, Decision-1 $0.042(OpenRouter가 호출별 비용을 돌려줌), Jev $0.042, 출력 요금 없음. 리그·시연·사진 실험의 호출 16,768번 전체 비용은 약 **0.61달러**였습니다(Decisions API 0.42, Jev 0.12, Decision-1 0.07, Laya 0).

API 키는 서버 프로세스 안에만 있고 브라우저로 내려가지 않습니다. 테트리스 엔진은 [laya-jev-arena](https://github.com/dante01yoon/laya-jev-arena)에서 시작했습니다.

License: MIT
