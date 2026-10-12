"""Decision arena server: one harness, four decision models, identical questions.

Every side receives the same state and the same named questions, written in the
TypeSafe / Decision-1 shape ({name: {type: choice|noul, instructions, criteria}}).
The OpenAI Decisions API uses a different wire format, so it gets a thin adapter
that translates the request and maps the answers back to the same shape.
API keys stay in this process and never reach the browser.
"""
import json, os, time, threading, http.server, socketserver, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
LOG = ROOT.parent / "evidence" / "calls.jsonl"
LOG.parent.mkdir(exist_ok=True)
_log_lock = threading.Lock()


def _load_env_files():
    for f in (str(ROOT.parent / ".env"), "~/.config/typesafe/env", "~/.config/openai/env", "~/.config/openrouter/env"):
        p = Path(f).expanduser()
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip().removeprefix("export ")
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_files()


def _post(url, key, body, timeout=20, attempts=3):
    """POST with retry on network errors and 429/5xx; the retry count is logged."""
    for i in range(attempts):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                out = json.loads(resp.read())
                out["retries"] = i
                return out
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500 or i == attempts - 1:
                raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:300]}")
        except (urllib.error.URLError, TimeoutError) as e:
            if i == attempts - 1:
                raise
        time.sleep(0.5 * (i + 1))


# --- laya: local, loaded once ----------------------------------------------
_laya = {"agent": None, "error": None}
_laya_lock = threading.Lock()


def laya_agent():
    with _laya_lock:
        if _laya["agent"] is None and _laya["error"] is None:
            try:
                os.environ.setdefault("USE_TF", "0")
                import torch, laya
                dev = "mps" if torch.backends.mps.is_available() else None
                t0 = time.time()
                _laya["agent"] = laya.load("convaiinnovations/laya", device=dev)
                print(f"[laya] loaded on {dev or 'cpu'} in {time.time()-t0:.1f}s", flush=True)
            except Exception as e:
                _laya["error"] = str(e)
                print(f"[laya] load failed: {e}", flush=True)
    if _laya["error"]:
        raise RuntimeError(_laya["error"])
    return _laya["agent"]


_laya_run = threading.Lock()


def decide_laya(state, questions):
    agent = laya_agent()
    with _laya_run:  # one forward pass at a time on the GPU
        r = agent.predict(state, questions)
    return {"model": "laya (local)", "answers": r["answers"], "usage": r.get("usage", {}), "cost_usd": 0.0}


# --- jev: TypeSafe ----------------------------------------------------------
JEV_PRICE_IN = 0.042 / 1e6  # USD per input token; see evidence/prices.json


def decide_jev(state, questions):
    r = _post("https://api.typesafe.ai/v1/systemone", os.environ["TYPESAFE_API_KEY"],
              {"model": "jev-latest", "state": state, "questions": questions})
    r["cost_usd"] = r.get("usage", {}).get("input_tokens", 0) * JEV_PRICE_IN
    return r


# --- Microsoft-Decision-1: OpenRouter decisions endpoint (same shape as Jev) --
def decide_d1(state, questions):
    r = _post("https://openrouter.ai/api/alpha/decisions", os.environ["OPENROUTER_API_KEY"],
              {"model": "microsoft/microsoft-decision-1", "state": state, "questions": questions})
    r["cost_usd"] = r.get("usage", {}).get("cost", 0.0)
    return r


# --- OpenAI Decisions API: translate request, map answers back -------------
OPENAI_PRICE_IN = 0.10 / 1e6


def _to_openai_question(name, q):
    crit = q.get("criteria") or {}
    if q["type"] == "noul":
        text = q["instructions"]
        if crit:
            text += f" True means: {crit.get('true', crit.get(True, ''))}. False means: {crit.get('false', crit.get(False, ''))}."
        return {"type": "predicate", "name": name, "instructions": text}
    if q["type"] == "choice":
        return {"type": "choice", "name": name, "instructions": q["instructions"],
                "choices": [{"value": k, "description": v} for k, v in crit.items()]}
    if q["type"] == "score":
        return {"type": "score", "name": name, "instructions": q["instructions"],
                "levels": [{"label": l} for l in crit]}
    raise ValueError(f"unsupported question type {q['type']}")


def decide_openai(state, questions, images=None):
    text = state if isinstance(state, str) else "\n".join(f"{k}: {v}" for k, v in state.items())
    inp = text
    if images:  # data URLs; the evidence is text plus the pictures
        inp = [{"role": "user", "content": [{"type": "input_text", "text": text}] +
                [{"type": "input_image", "image_url": u} for u in images]}]
    r = _post("https://api.openai.com/v1/decisions", os.environ["OPENAI_API_KEY"], {
        "model": "gpt-6-luna", "input": inp,
        "questions": [_to_openai_question(n, q) for n, q in questions.items()]})
    answers = {}
    for a in r["answers"]:
        if a["type"] == "predicate":
            answers[a["name"]] = {"type": "noul", "noul": a["probability"]}
        elif a["type"] == "choice":
            answers[a["name"]] = {"type": "choice", "choice": a["choice"], "confidence": a.get("confidence"),
                                  "probabilities": {p["value"]: p["probability"] for p in a["probabilities"]}}
        elif a["type"] == "score":
            answers[a["name"]] = {"type": "score", "score": a["score"], "confidence": a.get("confidence"),
                                  "probabilities": a.get("probabilities")}
        else:  # refusal
            answers[a["name"]] = {"type": a["type"]}
    usage = r.get("usage", {})
    return {"model": r.get("model"), "answers": answers, "usage": usage, "retries": r.get("retries", 0),
            "cost_usd": usage.get("input_tokens", 0) * OPENAI_PRICE_IN}


def decide_d1_images(state, questions, images):
    """Decision-1 with the image parts OpenRouter documents for multimodal decision models."""
    parts = [{"type": "text", "text": state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)}] + \
            [{"type": "image_url", "image_url": {"url": u}} for u in images]
    r = _post("https://openrouter.ai/api/alpha/decisions", os.environ["OPENROUTER_API_KEY"],
              {"model": "microsoft/microsoft-decision-1", "state": parts, "questions": questions}, attempts=1)
    r["cost_usd"] = r.get("usage", {}).get("cost", 0.0)
    return r


BACKENDS = {"laya": decide_laya, "jev": decide_jev, "openai": decide_openai, "d1": decide_d1,
            "openai-vision": decide_openai, "openai-text": decide_openai, "d1-vision": decide_d1_images}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if "/api/" not in (self.path or ""):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _json(self, code, payload):
        b = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/api/health":
            return self._json(200, {
                "laya": _laya["agent"] is not None,
                "jev": bool(os.environ.get("TYPESAFE_API_KEY")),
                "openai": bool(os.environ.get("OPENAI_API_KEY")),
                "d1": bool(os.environ.get("OPENROUTER_API_KEY")),
            })
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/decide"):
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(n))
            side = req["side"]
            t0 = time.perf_counter()
            if req.get("images"):
                out = BACKENDS[side](req["state"], req["questions"], req["images"])
            else:
                out = BACKENDS[side](req["state"], req["questions"])
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            out["side"] = side
            with _log_lock, LOG.open("a") as f:
                f.write(json.dumps({"t": time.time(), "side": side, "tag": req.get("tag"),
                                    "latency_ms": out["latency_ms"], "usage": out.get("usage"), "n_images": len(req.get("images") or []),
                                    "cost_usd": out.get("cost_usd"), "retries": out.get("retries", 0), "answers": out["answers"]}) + "\n")
            return self._json(200, out)
        except Exception as e:
            return self._json(500, {"error": f"{type(e).__name__}: {e}"})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8750
    threading.Thread(target=laya_agent, daemon=True).start()
    print(f"Decision arena on http://localhost:{port}/tetris/", flush=True)
    Server(("", port), Handler).serve_forever()
