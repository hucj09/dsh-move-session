"""Precise migration-integrity check: every source event must exist identically in the copy."""
import json
import zstandard as zstd
import os

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
    events = []
    header = None
    for line in data.decode("utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        if "version" in obj and "id" in obj and "events" not in obj and "seq" not in obj:
            header = obj
            continue
        events.append(obj)
    return header, events


def canon(e):
    return json.dumps(e.get("data"), sort_keys=True, ensure_ascii=False)


def seq_of(e):
    s = e.get("seq")
    return float(s) if isinstance(s, (int, float)) else None


SRC = "session-mv-msvan55b-1"   # source (ws-b)
DST = "session-mv-msvaodj5-1"   # moved copy (MoveSession workspace)

sh, se = load_events(SRC)
dh, de = load_events(DST)

print(f"source: {len(se)} lines, seq range {seq_of(se[0])}..{seq_of(se[-1])}")
print(f"copy  : {len(de)} lines, seq range {seq_of(de[0])}..{seq_of(de[-1])}")

# index the copy by seq (first occurrence wins; identical duplicates are fine)
copy_by_seq = {}
for e in de:
    s = seq_of(e)
    if s is None:
        continue
    if s not in copy_by_seq:
        copy_by_seq[s] = e

missing = []
different = []
matched = 0
for e in se:
    s = seq_of(e)
    if s is None:
        continue
    c = copy_by_seq.get(s)
    if c is None:
        missing.append(e)
        continue
    if c.get("type") == e.get("type") and c.get("time") == e.get("time") and canon(c) == canon(e):
        matched += 1
    else:
        different.append((e, c))

no_seq = [e for e in se if seq_of(e) is None]

print(f"\n== migration integrity ==")
print(f"source events with seq : {len(se) - len(no_seq)}")
print(f"exact match in copy    : {matched}")
print(f"missing from copy      : {len(missing)}")
print(f"present but different  : {len(different)}")
print(f"source events without seq: {len(no_seq)}")
if no_seq:
    from collections import Counter
    print("   no-seq types:", Counter(e.get("type") for e in no_seq))

if missing:
    print("\nmissing sample:")
    for e in missing[:8]:
        print("  ", e.get("seq"), e.get("type"))
if different:
    print("\ndifferent sample:")
    for e, c in different[:8]:
        print("  seq", e.get("seq"), "src", e.get("type"), "dst", c.get("type"))
        print("    src data:", json.dumps(e.get("data"), ensure_ascii=False)[:200])
        print("    dst data:", json.dumps(c.get("data"), ensure_ascii=False)[:200])

# title / projection-relevant events: session/title must be identical
print("\n== title events ==")
for e in se:
    if e.get("type") == "session/title":
        print("  src:", e.get("seq"), json.dumps(e.get("data"), ensure_ascii=False)[:120])
for e in de:
    if e.get("type") == "session/title":
        print("  dst:", e.get("seq"), json.dumps(e.get("data"), ensure_ascii=False)[:120])

# how much of the copy is post-migration new work?
copy_seqs = {seq_of(e) for e in de if seq_of(e) is not None}
src_seqs = {seq_of(e) for e in se if seq_of(e) is not None}
new_events = [e for e in de if seq_of(e) is not None and seq_of(e) not in src_seqs]
print(f"\n== copy growth after migration ==")
print(f"copy events beyond source seqs: {len(new_events)}")
if new_events:
    from collections import Counter
    print("   new event types:", dict(Counter(e.get("type") for e in new_events)))
