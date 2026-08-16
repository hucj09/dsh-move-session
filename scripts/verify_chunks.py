"""Verify chunk-stream records (no seq) are also fully preserved in the copy."""
import json
import zstandard as zstd
import os
from collections import Counter

BASE = os.path.expanduser(r"~\.dsh\sessions")


def find_session(session_id):
    for ws in os.listdir(BASE):
        path = os.path.join(BASE, ws, session_id, "session.jsonl.zstd")
        if os.path.exists(path):
            return path
    return None


def load_events(session_id):
    path = find_session(session_id)
    dctx = zstd.ZstdDecompressor()
    with open(path, "rb") as f:
        with dctx.stream_reader(f) as reader:
            data = reader.read()
    events, header = [], None
    for line in data.decode("utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        if "version" in obj and "id" in obj and "seq" not in obj and "events" not in obj:
            header = obj
            continue
        events.append(obj)
    return header, events


def chunk_key(e):
    # chunks are identified by type + turn + step (+ index when present)
    d = e.get("data") or {}
    return (e.get("type"), d.get("turn"), d.get("step"), d.get("index"), json.dumps(d, sort_keys=True, ensure_ascii=False))


SRC, DST = "session-mv-msvan55b-1", "session-mv-msvaodj5-1"
_, se = load_events(SRC)
_, de = load_events(DST)

src_chunks = [e for e in se if e.get("seq") is None]
dst_by_key = {}
for e in de:
    if e.get("seq") is not None:
        continue
    dst_by_key.setdefault(chunk_key(e), e)

missing = []
for e in src_chunks:
    if chunk_key(e) not in dst_by_key:
        missing.append(e)

print(f"source chunk records (no seq): {len(src_chunks)}")
print(f"missing from copy            : {len(missing)}")
if missing:
    print("  sample:", [(e.get('type'), (e.get('data') or {}).get('turn'), (e.get('data') or {}).get('step')) for e in missing[:8]])
else:
    print(">> ALL chunk records preserved identically")

# sanity: any structural difference in the first copy line vs source (header excluded already)
print("\nturn/step/tool structure in copy (post-migration growth excluded by seq set check done earlier)")
