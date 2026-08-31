#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sequential personazh faces via POST /v1/images/edits (approved v2 pipeline).

Output: ~/Desktop/personazh-foto/{key}-{1..10}.png
Progress: ~/Desktop/personazh-foto/_gen_progress.json

Usage:
  python3 brand/personazh/gen_personazh_realtime.py
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import sys
import time
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.openai.com/v1/images/edits"
ENV_FILE = Path("/Users/valerii/psyche_restored_env/local/psyche_openai.env")
REF = Path("/Users/valerii/Desktop/personazh-foto/_api_test/test-medium-saved-1-v2.png")
OUT = Path("/Users/valerii/Desktop/personazh-foto")
PROGRESS = OUT / "_gen_progress.json"
PROJECT = "proj_VGwXbjPrTuI3sJ8ipmtSrslb"
MODEL = "gpt-image-2"
SIZE = "1024x1024"
QUALITY = "medium"
MIN_SKIP_BYTES = 50_000

CONSTANT = """Minimalist monochrome cartoon face illustration.

CHARACTER: A soft, slightly irregular circle — like a smooth pebble or
a water droplet, never a perfect geometric circle. The outline is a single
confident brush stroke with subtly varying thickness, as if drawn with ink
in one motion. No body, no hair, no ears, no nose.

STYLE: Pure black ink on pure white background. High contrast, no grey,
no gradients, no shading, no texture, no outline glow.
Bold, thick strokes — every line at least 3% of the image width.
Generous empty space inside the face. Elegant and confident, like a single
brushstroke by a skilled illustrator. Warm and appealing, never creepy.

COMPOSITION: Square 1:1. The face is centered and occupies about 70% of
the frame, leaving clear white margin on all sides.

STRICTLY AVOID: thin lines, hatching, eyelashes, pupil highlights, dotted
textures, drop shadows, gradients, coloured areas, background elements,
text, watermarks, borders, frames, multiple faces in one image,
large cartoon eyes, features filling the whole face, wide open grins,
features centered vertically."""

SIGNATURE_STYLE = """SIGNATURE STYLE — this is essential:
The facial features are SMALL relative to the face — eyes no wider than
6% of the image, mouth no wider than 18%. They sit LOW, in the bottom
third of the circle, leaving the upper half generously empty.
The face is restrained and understated, never a big cartoon grin.

STRICTLY AVOID: large cartoon eyes, features filling the whole face,
features centered vertically."""

REF_INSTRUCTION = (
    "Match the reference image exactly in line weight, circle shape, "
    "proportions and overall style. Change ONLY the expression (and variation)."
)

QUEUE1 = ["saved", "reminded", "unheard", "thinking", "calm"]
QUEUE2 = ["happy", "warm", "laugh", "wink", "proud", "tired", "sleep"]
QUEUE3 = ["sad", "worried", "surprised", "sly"]
QUEUES = [("queue1", QUEUE1), ("queue2", QUEUE2), ("queue3", QUEUE3)]

EXPRESSIONS = {
    "saved": "EXPRESSION: calm contentment — relaxed curved eyes, a small satisfied smile.",
    "reminded": "EXPRESSION: attentive and reassuring — alert round eyes, a gentle closed smile, slightly raised brows.",
    "unheard": "EXPRESSION: puzzled — one brow raised higher than the other, eyes slightly narrowed, mouth a small wavy line.",
    "thinking": "EXPRESSION: concentrating — eyes looking upward to one side, mouth a short straight line.",
    "calm": "EXPRESSION: quiet and neutral — softly closed eyes, mouth a simple horizontal line. Serene, respectful, no smile at all.",
    "happy": "EXPRESSION: genuine joy — eyes squeezed into upward crescents, wide open smile.",
    "warm": "EXPRESSION: warm affection — soft half-closed eyes, tender small smile, head tilted slightly.",
    "laugh": "EXPRESSION: laughing — eyes as tight upward arcs, mouth wide open in a rounded laugh.",
    "wink": "EXPRESSION: playful wink — one eye closed as a downward curve, the other open, a lopsided grin.",
    "proud": "EXPRESSION: quiet pride — eyes gently closed, a confident closed smile, brows relaxed.",
    "tired": "EXPRESSION: sleepy — heavy half-closed eyelids, small tired smile, one brow drooping.",
    "sleep": "EXPRESSION: asleep — eyes as two closed curves, mouth a tiny relaxed line.",
    "sad": "EXPRESSION: gentle sadness — eyes turned down at the outer corners, mouth a soft downward curve.",
    "worried": "EXPRESSION: worried — brows drawn together and up, eyes wide, mouth a small uneven line.",
    "surprised": "EXPRESSION: surprised — wide round eyes, brows high, mouth a small open oval.",
    "sly": "EXPRESSION: knowing and sly — eyes narrowed into confident curves, one corner of the mouth raised.",
}

VARIATIONS = [
    "VARIATION: eyes noticeably larger and rounder than default.",
    "VARIATION: eyes small and close together, more space around them.",
    "VARIATION: the circle is wider than tall, slightly squashed.",
    "VARIATION: the circle is taller than wide, slightly stretched.",
    "VARIATION: the face is tilted about 10 degrees to the left.",
    "VARIATION: the face is tilted about 10 degrees to the right.",
    "VARIATION: eyes placed higher in the face, more room below the mouth.",
    "VARIATION: eyes placed lower in the face, more room above.",
    "VARIATION: the mouth is noticeably wider, taking most of the lower face.",
    "VARIATION: the outline is more irregular, almost hand-wobbled.",
]

V2_COPIES = {
    "saved-1": OUT / "_api_test/test-medium-saved-1-v2.png",
    "thinking-1": OUT / "_api_test/test-medium-thinking-1-v2.png",
    "calm-1": OUT / "_api_test/test-medium-calm-1-v2.png",
    "happy-1": OUT / "_api_test/test-medium-happy-1-v2.png",
}


def load_key() -> str:
    if not ENV_FILE.exists():
        raise SystemExit("missing env file: %s" % ENV_FILE)
    for line in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("OPENAI_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
            if key:
                return key
    raise SystemExit("OPENAI_API_KEY not found")


def build_prompt(expr_key: str, var_idx: int) -> str:
    return "\n\n".join([
        CONSTANT,
        SIGNATURE_STYLE,
        REF_INSTRUCTION,
        EXPRESSIONS[expr_key],
        VARIATIONS[var_idx - 1],
    ])


def load_progress() -> dict:
    if PROGRESS.exists():
        return json.loads(PROGRESS.read_text(encoding="utf-8"))
    return {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": "POST /v1/images/edits",
        "model": MODEL,
        "size": SIZE,
        "quality": QUALITY,
        "reference": str(REF),
        "queues": {},
        "completed": [],
        "skipped": [],
        "failed": [],
    }


def save_progress(prog: dict) -> None:
    prog["updated_at"] = datetime.now(timezone.utc).isoformat()
    prog["total_ok"] = len(prog.get("completed", []))
    prog["total_skip"] = len(prog.get("skipped", []))
    prog["total_fail"] = len(prog.get("failed", []))
    PROGRESS.write_text(json.dumps(prog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def should_skip(dest: Path) -> bool:
    return dest.is_file() and dest.stat().st_size > MIN_SKIP_BYTES


def copy_v2_approved() -> list[str]:
    copied = []
    for name, src in V2_COPIES.items():
        dest = OUT / ("%s.png" % name)
        if not src.is_file():
            print("WARN missing v2 source: %s" % src, flush=True)
            continue
        shutil.copy2(src, dest)
        copied.append(name)
        print("copied v2 -> %s.png" % name, flush=True)
    return copied


def api_edit(key: str, prompt: str, ref_bytes: bytes) -> tuple[int, dict]:
    bound = "----FormBoundary" + uuid.uuid4().hex
    parts: list[bytes] = []

    def field(name: str, value: str) -> None:
        parts.append(("--%s\r\n" % bound).encode())
        parts.append(('Content-Disposition: form-data; name="%s"\r\n\r\n' % name).encode())
        parts.append(("%s\r\n" % value).encode())

    for name, val in [
        ("model", MODEL),
        ("prompt", prompt),
        ("size", SIZE),
        ("quality", QUALITY),
        ("n", "1"),
        ("output_format", "png"),
    ]:
        field(name, val)

    parts.append(("--%s\r\n" % bound).encode())
    parts.append(b'Content-Disposition: form-data; name="image[]"; filename="reference.png"\r\n')
    parts.append(b"Content-Type: image/png\r\n\r\n")
    parts.append(ref_bytes)
    parts.append(b"\r\n")
    parts.append(("--%s--\r\n" % bound).encode())

    req = urllib.request.Request(
        API,
        data=b"".join(parts),
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "OpenAI-Project": PROJECT,
            "Content-Type": "multipart/form-data; boundary=%s" % bound,
        },
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status, json.loads(r.read().decode("utf-8", "replace"))


def save_response(data: dict, dest: Path) -> None:
    items = data.get("data") or []
    if not items:
        raise ValueError("no data: " + json.dumps(data)[:400])
    item = items[0]
    if item.get("b64_json"):
        dest.write_bytes(base64.b64decode(item["b64_json"]))
        return
    url = item.get("url")
    if url:
        with urllib.request.urlopen(url, timeout=120) as r:
            dest.write_bytes(r.read())
        return
    raise ValueError("no b64_json or url")


def generate_one(qname: str, expr_key: str, var_idx: int, api_key: str, ref_bytes: bytes, prog: dict) -> None:
    cid = "%s-%d" % (expr_key, var_idx)
    dest = OUT / ("%s.png" % cid)

    if should_skip(dest):
        prog["skipped"].append({"id": cid, "reason": "exists", "bytes": dest.stat().st_size})
        prog.setdefault("queues", {}).setdefault(qname, {"ok": 0, "skip": 0, "fail": 0})
        prog["queues"][qname]["skip"] = prog["queues"][qname].get("skip", 0) + 1
        save_progress(prog)
        print("SKIP %s" % cid, flush=True)
        return

    prompt = build_prompt(expr_key, var_idx)
    t0 = time.time()
    try:
        status, data = api_edit(api_key, prompt, ref_bytes)
        save_response(data, dest)
        elapsed = round(time.time() - t0, 1)
        prog["completed"].append({
            "id": cid, "queue": qname, "bytes": dest.stat().st_size,
            "elapsed_s": elapsed, "http_status": status,
        })
        prog.setdefault("queues", {}).setdefault(qname, {"ok": 0, "skip": 0, "fail": 0})
        prog["queues"][qname]["ok"] = prog["queues"][qname].get("ok", 0) + 1
        save_progress(prog)
        print("OK %s %d bytes %.1fs" % (cid, dest.stat().st_size, elapsed), flush=True)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", "replace")[:2000]
        prog["failed"].append({"id": cid, "queue": qname, "http_status": e.code, "error": err})
        prog.setdefault("queues", {}).setdefault(qname, {"ok": 0, "skip": 0, "fail": 0})
        prog["queues"][qname]["fail"] = prog["queues"][qname].get("fail", 0) + 1
        save_progress(prog)
        print("FAIL %s HTTP %s" % (cid, e.code), flush=True)
        if e.code == 429:
            time.sleep(60)
            generate_one(qname, expr_key, var_idx, api_key, ref_bytes, prog)
    except Exception as e:
        prog["failed"].append({"id": cid, "queue": qname, "error": str(e)})
        prog.setdefault("queues", {}).setdefault(qname, {"ok": 0, "skip": 0, "fail": 0})
        prog["queues"][qname]["fail"] = prog["queues"][qname].get("fail", 0) + 1
        save_progress(prog)
        print("FAIL %s: %s" % (cid, e), flush=True)


def count_queue(qkeys: list[str]) -> dict:
    present = missing = 0
    for k in qkeys:
        for i in range(1, 11):
            p = OUT / ("%s-%d.png" % (k, i))
            if p.is_file() and p.stat().st_size > MIN_SKIP_BYTES:
                present += 1
            else:
                missing += 1
    return {"present": present, "missing": missing, "target": len(qkeys) * 10}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "_api_test").mkdir(parents=True, exist_ok=True)
    if not REF.is_file():
        raise SystemExit("reference missing: %s — restore v2 test PNGs first" % REF)

    copied = copy_v2_approved()
    api_key = load_key()
    ref_bytes = REF.read_bytes()
    prog = load_progress()
    prog["v2_copied"] = copied

    for qname, qkeys in QUEUES:
        print("\n=== %s ===" % qname, flush=True)
        for expr_key in qkeys:
            for var_idx in range(1, 11):
                generate_one(qname, expr_key, var_idx, api_key, ref_bytes, prog)
        prog["queues"][qname] = count_queue(qkeys)
        save_progress(prog)

    prog["finished_at"] = datetime.now(timezone.utc).isoformat()
    save_progress(prog)
    return 1 if prog.get("failed") else 0


if __name__ == "__main__":
    raise SystemExit(main())
