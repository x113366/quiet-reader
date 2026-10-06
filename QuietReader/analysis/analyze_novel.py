#!/usr/bin/env python3
"""Local Chinese novel keyword analysis.

The output is deliberately JSON so the existing canvas can consume it without
coupling the reader to Python or requiring a network service.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

import jieba
import jieba.posseg as pseg

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "analysis_config.json"
CHAPTER_RE = re.compile(r"(?m)^\s*(?:第[零〇一二三四五六七八九十百千万\d]+[章节回部卷].{0,40}|Chapter\s+\d+.*)$")
TOKEN_RE = re.compile(r"^[\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9·_-]*$")
NAME_FLAGS = {"nr", "nr1", "nr2", "ns", "nt", "nz", "eng"}


def load_words(path: Path) -> set[str]:
    if not path.exists():
        return set()
    text = path.read_text(encoding="utf-8-sig")
    text = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
    return {part.strip().casefold() for part in re.split(r"[\s,，、]+", text) if part.strip()}


def fingerprint(source: Path, config: dict, files: list[Path]) -> str:
    digest = hashlib.sha256()
    digest.update(source.stat().st_size.__str__().encode())
    digest.update(source.stat().st_mtime_ns.__str__().encode())
    digest.update(json.dumps(config, ensure_ascii=False, sort_keys=True).encode())
    for path in files:
        digest.update(str(path).encode())
        if path.exists():
            digest.update(path.read_bytes())
    return digest.hexdigest()


def split_documents(text: str, chunk_chars: int) -> tuple[list[str], str]:
    matches = list(CHAPTER_RE.finditer(text))
    if len(matches) >= 2:
        starts = [m.start() for m in matches]
        docs = [text[starts[i]:starts[i + 1]] for i in range(len(starts) - 1)]
        docs.append(text[starts[-1]:])
        return docs, "chapter"
    return [text[i:i + chunk_chars] for i in range(0, len(text), chunk_chars)], "fixed_chunk"


def phrase_candidates(tokens_by_doc: list[list[tuple[str, str]]], min_count: int = 3) -> dict[str, float]:
    unigram = Counter()
    grams = Counter()
    for tokens in tokens_by_doc:
        words = [w for w, _ in tokens]
        unigram.update(words)
        for size in (2, 3):
            grams.update("".join(words[i:i + size]) for i in range(len(words) - size + 1))
    total = max(sum(unigram.values()), 1)
    candidates = {}
    for phrase, count in grams.items():
        if count < min_count or len(phrase) > 12:
            continue
        parts = [phrase[:i] for i in range(1, len(phrase)) if phrase[:i] in unigram]
        if not parts:
            continue
        left = parts[-1]
        right = phrase[len(left):]
        if right not in unigram:
            continue
        pmi = math.log((count * total) / max(unigram[left] * unigram[right], 1))
        if pmi >= 1.8:
            candidates[phrase] = count * pmi
    return candidates


def analyze(source: Path, config: dict, cache_path: Path) -> dict:
    started = time.perf_counter()
    stop_files = [ROOT / path for path in config["hard_stopword_files"]]
    stopwords = set().union(*(load_words(path) for path in stop_files))
    custom = load_words(stop_files[-1])
    protected = {w.casefold() for w in config.get("protected_terms", [])}
    downweights = {w.casefold(): float(v) for w, v in config.get("downweight_terms", {}).items()}
    cache_key = fingerprint(source, config, stop_files)
    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        if cached.get("cache_key") == cache_key:
            cached["runtime_ms"] = round((time.perf_counter() - started) * 1000, 1)
            cached["cache_hit"] = True
            return cached

    text = source.read_text(encoding="utf-8-sig", errors="replace")
    documents, segmentation = split_documents(text, int(config["chunk_chars"]))
    total_docs = len(documents)
    stats = {}
    tokens_by_doc = []
    raw_filtered = Counter()
    raw_pos = Counter()

    for doc_id, document in enumerate(documents):
        doc_tokens = []
        for item in pseg.cut(document):
            word = item.word.strip()
            word = word.casefold() if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", word) else word
            flag = item.flag or "x"
            if not word or not TOKEN_RE.match(word) or re.fullmatch(r"\d+(?:\.\d+)?", word):
                continue
            if word in stopwords:
                raw_filtered[word] += 1
                raw_pos[word] += 1
                continue
            if len(word) > int(config["max_token_chars"]):
                continue
            doc_tokens.append((word, flag))
        tokens_by_doc.append(doc_tokens)

    phrases = phrase_candidates(tokens_by_doc)
    phrase_index = defaultdict(list)
    for phrase in phrases:
        phrase_index[phrase[0]].append(phrase)
    for key in phrase_index:
        phrase_index[key].sort(key=len, reverse=True)
    for doc_id, doc_tokens in enumerate(tokens_by_doc):
        words = [w for w, _ in doc_tokens]
        i = 0
        while i < len(doc_tokens):
            match = next((p for p in phrase_index.get(words[i][0], ())
                          if "".join(words[i:i + len(p)]) == p), None)
            if match:
                pos = "nz"
                add_stat(stats, match, pos, doc_id, 1, total_docs, phrases, protected, downweights)
                i += len(match)
            else:
                word, pos = doc_tokens[i]
                add_stat(stats, word, pos, doc_id, 1, total_docs, phrases, protected, downweights)
                i += 1

    # Lightweight TextRank: co-occurrence graph over the already-filtered stream.
    graph = defaultdict(Counter)
    for doc_tokens in tokens_by_doc:
        words = list(dict.fromkeys(w for w, _ in doc_tokens))
        for i, word in enumerate(words):
            for other in words[i + 1:i + 6]:
                if word != other:
                    graph[word][other] += 1
                    graph[other][word] += 1
    rank = {word: 1.0 for word in stats}
    for _ in range(12):
        rank = {word: 0.15 + 0.85 * sum(rank.get(other, 0) * weight / max(sum(graph.get(word, {}).values()), 1)
                                         for other, weight in graph.get(word, {}).items())
                for word in stats}
    max_rank = max(rank.values(), default=1)

    rows = []
    for word, item in stats.items():
        tf = math.log1p(item["count"])
        coverage = item["documents"] / max(total_docs, 1)
        dispersion = 0.65 + 0.35 * math.sqrt(coverage)
        idf = math.log((1 + total_docs) / (1 + item["documents"])) + 1
        pos_weight = float(config["pos_weights"].get(item["pos"], 0.5))
        entity = 1.25 if item["proper_noun"] else 1.0
        phrase = 1.18 if item["phrase"] else 1.0
        narrative = downweights.get(word, 1.0)
        keyword_signal = 0.55 * (idf / 3.0) + 0.45 * (rank.get(word, 0) / max_rank)
        score = tf * pos_weight * entity * phrase * narrative * dispersion * (0.75 + keyword_signal)
        rows.append({**item, "coverage": round(coverage, 4), "tfidf": round(tf * idf, 4),
                     "textrank": round(rank.get(word, 0) / max_rank, 4),
                     "final_score": round(score, 4),
                     "rule": "BOOST" if item["proper_noun"] or item["phrase"] else
                             ("DOWNWEIGHT" if narrative < 1 else "NORMAL")})
    for item in rows:
        item.pop("_docs", None)
    rows.sort(key=lambda row: row["final_score"], reverse=True)
    filtered = [{"word": word, "count": count, "reason": "stopword", "pos": raw_pos[word]}
                for word, count in raw_filtered.most_common(100)]
    downweighted = sorted(
        (row for row in rows if row["rule"] == "DOWNWEIGHT"),
        key=lambda row: row["count"], reverse=True
    )[:100]
    result = {
        "cache_key": cache_key, "cache_hit": False, "source": str(source),
        "segmentation": segmentation, "documents": total_docs,
        "runtime_ms": round((time.perf_counter() - started) * 1000, 1),
        "keywords": rows[:int(config["max_keywords"])],
        "filtered_high_frequency": filtered,
        "downweighted_high_frequency": downweighted,
        "config": {"stopword_files": [str(p) for p in stop_files], "custom_count": len(custom)}
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def add_stat(stats, word, pos, doc_id, count, total_docs, phrases, protected, downweights):
    item = stats.setdefault(word, {"word": word, "count": 0, "pos": pos, "documents": 0,
                                   "proper_noun": pos in NAME_FLAGS or word.casefold() in protected,
                                   "phrase": word in phrases, "downweight": downweights.get(word, 1.0),
                                   "_docs": set()})
    item["count"] += count
    if doc_id not in item["_docs"]:
        item["_docs"].add(doc_id)
        item["documents"] += 1
    item["pos"] = item["pos"] if item["pos"] in NAME_FLAGS else pos
    item.pop("_docs", None) if False else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, default=ROOT / "outputs/wordcloud/analysis.json")
    parser.add_argument("--config", type=Path, default=CONFIG)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    result = analyze(args.source, config, args.out)
    report = args.out.with_name(args.out.stem + "_report.txt")
    wordcloud_input = args.out.with_name("keywords_for_wordcloud.txt")
    wordcloud_input.write_text(
        "\n".join(f"{row['word']}, {row['final_score']:.4f}" for row in result["keywords"]),
        encoding="utf-8"
    )
    report.write_text("Top 30 keywords\n" + "\n".join(
        f"{i + 1:02d}. {r['word']}\t{r['count']}\t{r['pos']}\t{r['coverage']:.1%}\t{r['rule']}\t{r['final_score']}"
        for i, r in enumerate(result["keywords"][:30])) + "\n\nFiltered high-frequency\n" + "\n".join(
        f"{i + 1:02d}. {r['word']}\t{r['count']}\t{r['pos']}" for i, r in enumerate(result["filtered_high_frequency"][:30])) +
        "\n\nDownweighted high-frequency\n" + "\n".join(
        f"{i + 1:02d}. {r['word']}\t{r['count']}\t{r['pos']}\t{r['final_score']}"
        for i, r in enumerate(result["downweighted_high_frequency"][:30])),
        encoding="utf-8")
    print(json.dumps({"cache_hit": result["cache_hit"], "runtime_ms": result["runtime_ms"],
                      "keywords": [r["word"] for r in result["keywords"][:30]],
                      "report": str(report), "wordcloud_input": str(wordcloud_input)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
