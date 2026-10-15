#!/usr/bin/env python3
"""Extract named gym POIs and settlements from a Geofabrik OSM PBF snapshot."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Iterable, Mapping

SOURCE_URL = "https://download.geofabrik.de/south-america/bolivia-261008.osm.pbf"
ATTRIBUTION = "© OpenStreetMap contributors"
LICENSE = "ODbL-1.0"


def classify_tags(tags: Mapping[str, str]) -> set[str]:
    kinds: set[str] = set()
    if (
        tags.get("amenity") == "gym"
        or tags.get("leisure") == "fitness_centre"
        or (tags.get("leisure") == "sports_centre" and tags.get("sport") == "fitness")
    ):
        kinds.add("GYM")
    if tags.get("place") in {"city", "town", "village"}:
        kinds.add("CITY")
    return kinds


def source_id(object_type: str, object_id: int) -> str:
    if object_type not in {"node", "way", "relation"} or object_id <= 0:
        raise ValueError("OSM provenance must use a positive node, way, or relation identity.")
    return f"{object_type}/{object_id}"


def area_center(coordinates: Iterable[tuple[float, float]]) -> dict[str, float] | None:
    valid = [
        (latitude, longitude)
        for latitude, longitude in coordinates
        if -85 <= latitude <= 85 and -180 <= longitude <= 180
    ]
    if not valid:
        return None
    return {
        "latitude": round((min(point[0] for point in valid) + max(point[0] for point in valid)) / 2, 6),
        "longitude": round((min(point[1] for point in valid) + max(point[1] for point in valid)) / 2, 6),
    }


def _tag_snapshot(tags: Mapping[str, str]) -> dict[str, str]:
    return {
        key: value
        for key, value in tags.items()
        if key in {"amenity", "leisure", "sport", "place", "brand", "addr:street", "addr:housenumber", "addr:city", "addr:state"}
    }


def _place(kind: str, object_type: str, object_id: int, tags: Mapping[str, str], center: Mapping[str, float]) -> dict[str, object] | None:
    name = tags.get("name", "").strip()
    if not name:
        return None
    street = tags.get("addr:street", "").strip()
    number = tags.get("addr:housenumber", "").strip()
    address = " ".join(part for part in (street, number) if part) or None
    return {
        "kind": kind,
        "source": "OPENSTREETMAP",
        "sourceId": source_id(object_type, object_id),
        "name": name[:180],
        "address": address[:240] if address else None,
        "city": (tags.get("addr:city") or "").strip()[:120] or None,
        "region": (tags.get("addr:state") or "").strip()[:120] or None,
        "latitude": center["latitude"],
        "longitude": center["longitude"],
        "tags": _tag_snapshot(tags),
        "license": LICENSE,
        "attribution": ATTRIBUTION,
    }


class PlaceExtractor:
    """Small callback adapter so the extraction rules remain testable without pyosmium."""

    def __init__(self):
        self.records: list[dict[str, object]] = []
        self.counts: Counter[str] = Counter()
        self.bounds = {"south": 90.0, "west": 180.0, "north": -90.0, "east": -180.0}

    def add(self, object_type: str, object_id: int, tags: Mapping[str, str], center: Mapping[str, float] | None):
        if center is None:
            return
        for kind in classify_tags(tags):
            record = _place(kind, object_type, object_id, tags, center)
            if record is None:
                continue
            self.records.append(record)
            self.counts[kind] += 1
            self.bounds["south"] = min(self.bounds["south"], float(center["latitude"]))
            self.bounds["north"] = max(self.bounds["north"], float(center["latitude"]))
            self.bounds["west"] = min(self.bounds["west"], float(center["longitude"]))
            self.bounds["east"] = max(self.bounds["east"], float(center["longitude"]))


def extract_pbf(pbf_path: Path) -> PlaceExtractor:
    try:
        import osmium
    except ImportError as error:
        raise RuntimeError("Install the pinned QA dependency with: python3 -m pip install osmium==4.3.1") from error

    extractor = PlaceExtractor()

    class Handler(osmium.SimpleHandler):
        def node(self, node):
            tags = node.tags
            candidate = (
                tags.get("amenity") == "gym"
                or tags.get("leisure") == "fitness_centre"
                or (tags.get("leisure") == "sports_centre" and tags.get("sport") == "fitness")
                or tags.get("place") in {"city", "town", "village"}
            )
            if not candidate or not node.location.valid():
                return
            extractor.add("node", node.id, dict(tags), {
                "latitude": node.location.lat,
                "longitude": node.location.lon,
            })

        def way(self, way):
            tags = way.tags
            candidate = (
                tags.get("amenity") == "gym"
                or tags.get("leisure") == "fitness_centre"
                or (tags.get("leisure") == "sports_centre" and tags.get("sport") == "fitness")
                or tags.get("place") in {"city", "town", "village"}
            )
            if not candidate:
                return
            coordinates = [
                (node.lat, node.lon) for node in way.nodes if node.location.valid()
            ]
            extractor.add("way", way.id, dict(tags), area_center(coordinates))

    Handler().apply_file(str(pbf_path), locations=True, idx="flex_mem")
    return extractor


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_id(path: Path) -> str:
    match = re.search(r"bolivia-(\d{6,8})\.osm\.pbf$", path.name)
    return match.group(1) if match else path.name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Geofabrik Bolivia OSM PBF")
    parser.add_argument("--output", type=Path, required=True, help="NDJSON output for the import stage")
    parser.add_argument("--manifest", type=Path, required=True, help="Provenance and coverage manifest")
    args = parser.parse_args()
    if not args.input.is_file():
        parser.error(f"PBF file does not exist: {args.input}")

    extracted = extract_pbf(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as output:
        for record in extracted.records:
            output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")

    manifest = {
        "sourceUrl": SOURCE_URL,
        "snapshot": snapshot_id(args.input),
        "downloadedAtUtc": datetime.now(timezone.utc).isoformat(),
        "inputBytes": args.input.stat().st_size,
        "sha256": sha256_file(args.input),
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "selectedTags": [
            "amenity=gym", "leisure=fitness_centre", "leisure=sports_centre+sport=fitness",
            "place=city|town|village",
        ],
        "counts": dict(sorted(extracted.counts.items())),
        "bbox": extracted.bounds if extracted.records else None,
        "records": len(extracted.records),
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": manifest["records"], "counts": manifest["counts"], "manifest": str(args.manifest)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"OSM extract failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
