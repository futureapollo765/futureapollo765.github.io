"""Offline checks for public-field exports and safe catalog refreshes."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import refresh_scratch as sync


class ScratchSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.assets = self.root / "assets" / "projects"
        self.details = self.root / "assets" / "project-details"
        self.catalog = self.root / "scratch-catalog.js"
        self.staging = self.root / "staging"
        for folder in (self.assets, self.details, self.staging / "project-details"):
            folder.mkdir(parents=True)
        for project_id in (1, 2):
            (self.assets / f"{project_id}.webp").write_bytes(b"existing curated capture")
        paths = patch.multiple(sync, ROOT=self.root, ASSETS=self.assets, DETAILS=self.details, CATALOG=self.catalog)
        paths.start()
        self.addCleanup(paths.stop)

    def row(self, project_id=1, **changes):
        row = {
            "id": project_id, "title": "Public project", "public": True, "is_published": True,
            "instructions": "Press Space.\nThen drag. 中文", "description": "Credits: public contributor.",
            "history": {"shared": "2026-11-01T12:00:00Z"},
            "images": {"282x218": f"https://example.invalid/{project_id}.png?v=1"},
        }
        return {**row, **changes}

    def payload(self, project_id=1):
        return json.loads((self.staging / "project-details" / f"{project_id}.json").read_text())

    def test_owned_export_whitelists_text_without_extra_requests(self):
        row = self.row(project_token="DO_NOT_EXPORT_TOKEN", author={"profile": "DO_NOT_EXPORT_PROFILE"})
        with patch.object(sync, "fetch", side_effect=AssertionError("Unexpected API request")):
            item = sync.make_item(row, {1}, {}, self.staging)
        self.assertEqual(item["embed"], "https://turbowarp.org/1/embed?hqpen")
        self.assertEqual(item["author"], sync.USER)
        self.assertEqual(item["detailSections"], ["instructions", "notesAndCredits"])
        self.assertEqual(self.payload(), {
            "id": 1, "instructions": row["instructions"], "notesAndCredits": row["description"],
        })
        serialized = json.dumps(item) + json.dumps(self.payload())
        self.assertNotIn("DO_NOT_EXPORT", serialized)
        self.assertNotIn("project_token", serialized)

    def test_non_owned_favorite_resolves_public_author_and_fresh_text(self):
        listing = self.row(2, description="Older listing text")
        detail = self.row(2, instructions="Fresh instructions", description="Fresh notes",
                          author={"username": "PublicCreator", "profile": {"private": "DO_NOT_EXPORT_PROFILE"}},
                          project_token="DO_NOT_EXPORT_TOKEN")
        previous = {2: {"embed": "https://turbowarp.org/2/embed"}}
        with patch.object(sync, "fetch", return_value=json.dumps(detail).encode()) as fetch:
            item = sync.make_item(listing, {1}, previous, self.staging)
        fetch.assert_called_once_with(f"{sync.API}/projects/2")
        self.assertEqual(item["author"], "PublicCreator")
        self.assertEqual(item["embed"], "https://turbowarp.org/2/embed?hqpen")
        self.assertEqual(self.payload(2)["notesAndCredits"], "Fresh notes")
        self.assertNotIn("DO_NOT_EXPORT", json.dumps(item) + json.dumps(self.payload(2)))

    def test_missing_listing_text_is_backfilled_and_blank_text_stays_blank(self):
        row = self.row()
        del row["description"]
        with patch.object(sync, "fetch", return_value=json.dumps(self.row(description="Backfilled")).encode()) as fetch:
            item = sync.make_item(row, {1}, {}, self.staging)
        fetch.assert_called_once_with(f"{sync.API}/projects/1")
        self.assertEqual(self.payload()["notesAndCredits"], "Backfilled")
        self.assertEqual(item["detailSections"], ["instructions", "notesAndCredits"])
        with patch.object(sync, "fetch", side_effect=AssertionError("Blank text is valid")):
            item = sync.make_item(self.row(instructions="", description=None), {1}, {}, self.staging)
        self.assertEqual(self.payload(), {"id": 1, "instructions": "", "notesAndCredits": ""})
        self.assertEqual(item["detailSections"], [])
        for instructions, notes, expected in (
            ("\r\n \t\u00a0\u2003", "", []),
            ("\n Read this. \r\n", "\t", ["instructions"]),
            (" \r\n", " Credits. \n", ["notesAndCredits"]),
        ):
            with self.subTest(instructions=instructions, notes=notes), \
                    patch.object(sync, "fetch", side_effect=AssertionError("Whitespace text is valid")):
                item = sync.make_item(self.row(instructions=instructions, description=notes), {1}, {}, self.staging)
            self.assertEqual(item["detailSections"], expected)
            self.assertEqual(self.payload()["instructions"], instructions)
            self.assertEqual(self.payload()["notesAndCredits"], notes)
        empty_detail = self.row()
        del empty_detail["instructions"]
        del empty_detail["description"]
        with patch.object(sync, "fetch", return_value=json.dumps(empty_detail).encode()):
            item = sync.make_item(empty_detail, {1}, {}, self.staging)
        self.assertEqual(item["detailSections"], [])

    def test_nonpublic_or_mismatched_details_are_rejected(self):
        with self.assertRaises(ValueError):
            sync.make_item(self.row(public=False), {1}, {}, self.staging)
        with patch.object(sync, "fetch", return_value=json.dumps(self.row(99)).encode()):
            with self.assertRaises(ValueError):
                sync.make_item(self.row(2), {1}, {}, self.staging)
        with self.assertRaises(ValueError):
            sync.make_item(self.row(instructions={"unexpected": "structure"}), {1}, {}, self.staging)
        self.assertEqual(list((self.staging / "project-details").iterdir()), [])

    def test_backfill_and_text_updates_publish_versioned_details(self):
        self.catalog.write_text(sync.PREFIX + json.dumps({
            "projects": [1], "favorites": [1],
            "items": [{"id": 1, "embed": "https://turbowarp.org/1/embed?hqpen"}],
        }) + ";\n")
        (self.details / "999.json").write_text("obsolete")
        (self.details / "keep.txt").write_text("unrelated file")
        row = self.row()
        with patch.object(sync, "listing", return_value=[row]), contextlib.redirect_stdout(io.StringIO()):
            sync.main()
        first = sync.previous_items()[1]
        self.assertTrue((self.details / "1.json").exists())
        self.assertIn("?v=", first["details"])
        self.assertEqual(first["embed"], "https://turbowarp.org/1/embed?hqpen")
        self.assertFalse((self.details / "999.json").exists())
        self.assertTrue((self.details / "keep.txt").exists())
        original = (self.details / "1.json").read_bytes()
        with patch.object(sync, "listing", return_value=[row]), contextlib.redirect_stdout(io.StringIO()):
            sync.main()
        self.assertEqual(first["details"], sync.previous_items()[1]["details"])
        row["instructions"] = "Updated public text."
        with patch.object(sync, "listing", return_value=[row]), contextlib.redirect_stdout(io.StringIO()):
            sync.main()
        self.assertNotEqual(original, (self.details / "1.json").read_bytes())
        self.assertNotEqual(first["details"], sync.previous_items()[1]["details"])

    def test_fetch_failure_keeps_last_published_snapshot(self):
        self.catalog.write_text(sync.PREFIX + json.dumps({"projects": [1], "favorites": [], "items": [{"id": 1}]}) + ";\n")
        (self.details / "1.json").write_text('{"id":1,"instructions":"Existing","notesAndCredits":""}')
        (self.details / "999.json").write_text("not yet pruned")
        before = {p: p.read_bytes() for p in (self.catalog, self.details / "1.json", self.details / "999.json")}
        second = self.row(2)
        del second["instructions"]
        with patch.object(sync, "listing", side_effect=lambda name: [self.row(), second] if name == "projects" else []), \
                patch.object(sync, "fetch", side_effect=RuntimeError("Public API unavailable")):
            with self.assertRaises(RuntimeError):
                sync.main()
        self.assertTrue(all(p.read_bytes() == content for p, content in before.items()))
        self.assertEqual(list(self.root.glob(".scratch-sync-*")), [])


if __name__ == "__main__":
    unittest.main()
