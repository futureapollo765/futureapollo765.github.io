"""Refresh public Scratch projects, covers, share dates, and on-demand details."""
import concurrent.futures
from datetime import datetime, timezone
import hashlib
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
DETAILS = ROOT / "assets" / "project-details"
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


def project_details(project_id, source, staging):
    # Only these public text fields are exported. The project API also returns
    # a project_token and author profile data, neither of which belongs here.
    payload = {"id": project_id}
    for api_name, public_name in (("instructions", "instructions"), ("description", "notesAndCredits")):
        value = source.get(api_name)
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise ValueError(f"Invalid public project text for {project_id}: {api_name}")
        payload[public_name] = value
    content = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    revision = hashlib.sha256(content).hexdigest()[:12]
    name = f"{project_id}.json"
    destination = DETAILS / name
    if not destination.exists() or destination.read_bytes() != content:
        (staging / "project-details" / name).write_bytes(content)
    return f"./assets/project-details/{name}?v={revision}"


def make_item(row, owned_ids, previous, staging):
    project_id = row["id"]
    if type(project_id) is not int or project_id <= 0:
        raise ValueError("Invalid Scratch project ID")
    if row.get("public") is False or row.get("is_published") is False:
        raise ValueError(f"Project {project_id} is not public")
    source = row
    history = row.get("history") or {}
    # Listings include public project text, but omit author usernames. Resolve
    # non-owned favorites and backfill a listing that lacks either text field.
    if project_id not in owned_ids or any(key not in row for key in ("instructions", "description")):
        detail = json.loads(fetch(f"{API}/projects/{project_id}"))
        if detail.get("id") != project_id or detail.get("public") is False or detail.get("is_published") is False:
            raise ValueError(f"Invalid public Scratch project response for {project_id}")
        source = detail
        history = detail.get("history") or history
    author = USER if project_id in owned_ids else source.get("author", {}).get("username")
    if not isinstance(author, str) or not author:
        raise ValueError(f"Missing public Scratch author for {project_id}")
    details = project_details(project_id, source, staging)

    # Locally curated running-stage captures take priority over Scratch cover art.
    name = f"{project_id}.webp"
    thumbnail = f"./assets/projects/{name}"
    if (ASSETS / name).exists():
        # Revisions follow the actual capture, so returning visitors see a new
        # curated image and routine catalog refreshes keep the same cache key.
        revision = hashlib.sha256((ASSETS / name).read_bytes()).hexdigest()[:12]
        thumbnail += f"?v={revision}"
    else:
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

    # All players use TurboWarp. Preserve previously enabled high-quality pen
    # rendering even when a creator later removes its mention from the notes.
    notes = ((source.get("description") or "") + " " + (source.get("instructions") or "")).lower()
    prior_query = parse_qs(urlsplit(previous.get(project_id, {}).get("embed", "")).query, keep_blank_values=True)
    hqpen = "hqpen" in prior_query or "hqpen" in notes or project_id in (1406787990, 953460273, 1388418319)
    embed = f"https://turbowarp.org/{project_id}/embed" + ("?hqpen" if hqpen else "")
    return {"id": project_id, "title": row["title"], "author": author, "sharedAt": shared_at(history),
            "thumbnail": thumbnail, "embed": embed, "details": details}


def main():
    previous = previous_items()
    projects = listing("projects")
    favorites = listing("favorites")
    owned = {row["id"] for row in projects}
    rows = {row["id"]: row for row in projects}
    for row in favorites:
        rows.setdefault(row["id"], row)
    ASSETS.mkdir(parents=True, exist_ok=True)
    DETAILS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".scratch-sync-", dir=ROOT) as directory:
        staging = Path(directory)
        (staging / "project-details").mkdir()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            items = list(pool.map(lambda row: make_item(row, owned, previous, staging), rows.values()))
        catalog = {
            "projects": [row["id"] for row in projects],
            "favorites": [row["id"] for row in favorites],
            "items": items,
        }
        source = PREFIX + json.dumps(catalog, indent=2, ensure_ascii=False) + ";\n"
        (staging / CATALOG.name).write_text(source)
        # Failed requests leave the published snapshot intact. Publish the
        # manifest only after all referenced covers and text files are available.
        for path in staging.glob("*.png"):
            os.replace(path, ASSETS / path.name)
        for path in (staging / "project-details").glob("*.json"):
            os.replace(path, DETAILS / path.name)
        os.replace(staging / CATALOG.name, CATALOG)
    used_images = {row["thumbnail"].split("?")[0].split("/")[-1] for row in items}
    for path in ASSETS.glob("*.png"):
        if path.stem.isdecimal() and path.name not in used_images:
            path.unlink()
    used_details = {f"{row['id']}.json" for row in items}
    for path in DETAILS.glob("*.json"):
        if path.stem.isdecimal() and path.name not in used_details:
            path.unlink()
    print(f"Refreshed {len(projects)} shared projects, {len(favorites)} public favorites, and {len(items)} public detail files.")


if __name__ == "__main__":
    main()
