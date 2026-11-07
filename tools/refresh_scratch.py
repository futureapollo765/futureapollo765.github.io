"""Refresh the public Scratch catalog, cover images, and project share dates."""
import concurrent.futures
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "projects"
CATALOG = ROOT / "scratch-catalog.js"
USER = "FutureApollo765"
API = "https://api.scratch.mit.edu"
PREFIX = "export default "
PAGE_SIZE = 40


def fetch(url):
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"User-Agent": "FutureApollo765 portfolio sync"}), timeout=30) as response:
                return response.read()
        except HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise
        except (URLError, TimeoutError):
            if attempt == 3:
                raise
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Scratch request failed after retries: {url}")


def listing(name):
    rows = []
    seen = set()
    offset = 0
    while True:
        batch = json.loads(fetch(f"{API}/users/{USER}/{name}?limit={PAGE_SIZE}&offset={offset}"))
        if not isinstance(batch, list):
            raise ValueError(f"Invalid Scratch {name} response at offset {offset}")
        before = len(seen)
        for row in batch:
            if row["id"] not in seen:
                seen.add(row["id"])
                rows.append(row)
        if len(batch) < PAGE_SIZE:
            return rows
        if len(seen) == before:
            raise ValueError(f"Scratch repeated a full page of {name}")
        offset += len(batch)


def previous_items():
    if not CATALOG.exists():
        return {}
    raw = CATALOG.read_text().removeprefix(PREFIX).rstrip().removesuffix(";")
    return {row["id"]: row for row in json.loads(raw)["items"]}


def shared_at(history):
    value = history.get("shared")
    if not isinstance(value, str):
        return None
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            return None
        return timestamp.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError):
        return None


def make_item(row, owned_ids, previous, staging):
    project_id = row["id"]
    if type(project_id) is not int or project_id <= 0:
        raise ValueError("Invalid Scratch project ID")
    history = row.get("history") or {}
    if project_id in owned_ids:
        author = USER
    else:
        detail = json.loads(fetch(f"{API}/projects/{project_id}"))
        author = detail["author"]["username"]
        history = detail.get("history") or history

    # Locally curated running-stage captures take priority over Scratch cover art.
    name = f"{project_id}.webp"
    thumbnail = f"./assets/projects/{name}"
    if not (ASSETS / name).exists():
        version = parse_qs(urlsplit(row["images"]["282x218"]).query).get("v", [history.get("modified")])[0]
        query = f"?v={version}" if version else ""
        name = f"{project_id}.png"
        thumbnail = f"./assets/projects/{name}{query}"
        if previous.get(project_id, {}).get("thumbnail") != thumbnail or not (ASSETS / name).exists():
            url = f"https://cdn2.scratch.mit.edu/get_image/project/{project_id}_480x360.png{query}"
            png = fetch(url)
            if not png.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError(f"Invalid Scratch thumbnail for {project_id}")
            (staging / name).write_bytes(png)

    # Respect explicit TurboWarp project links while keeping embed hosts fixed.
    notes = (row.get("description", "") + " " + row.get("instructions", "")).lower()
    turbowarp = f"turbowarp.org/{project_id}" in notes or project_id in (1406787990, 953460273, 1388418319)
    embed = f"https://scratch.mit.edu/projects/{project_id}/embed?autostart=false"
    if turbowarp:
        hqpen = "hqpen" in notes or project_id in (1406787990, 953460273, 1388418319)
        embed = f"https://turbowarp.org/{project_id}/embed" + ("?hqpen" if hqpen else "")
    return {"id": project_id, "title": row["title"], "author": author, "sharedAt": shared_at(history),
            "thumbnail": thumbnail, "embed": embed}


def main():
    previous = previous_items()
    projects = listing("projects")
    favorites = listing("favorites")
    owned = {row["id"] for row in projects}
    rows = {row["id"]: row for row in projects}
    for row in favorites:
        rows.setdefault(row["id"], row)
    ASSETS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".scratch-sync-", dir=ROOT) as directory:
        staging = Path(directory)
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            items = list(pool.map(lambda row: make_item(row, owned, previous, staging), rows.values()))
        catalog = {
            "projects": [row["id"] for row in projects],
            "favorites": [row["id"] for row in favorites],
            "items": items,
        }
        source = PREFIX + json.dumps(catalog, indent=2, ensure_ascii=False) + ";\n"
        (staging / CATALOG.name).write_text(source)
        # Publish the manifest only after every referenced thumbnail is available.
        for path in staging.glob("*.png"):
            os.replace(path, ASSETS / path.name)
        os.replace(staging / CATALOG.name, CATALOG)
    used_images = {row["thumbnail"].split("?")[0].split("/")[-1] for row in items}
    for path in ASSETS.glob("*.png"):
        if path.stem.isdecimal() and path.name not in used_images:
            path.unlink()
    print(f"Refreshed {len(projects)} shared projects and {len(favorites)} public favorites.")


if __name__ == "__main__":
    main()
