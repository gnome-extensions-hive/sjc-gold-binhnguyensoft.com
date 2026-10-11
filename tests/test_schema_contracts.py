"""Source-schema contracts, runnable without GNOME or third-party packages."""

import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = (
    ROOT / "schemas"
    / "org.gnome.shell.extensions.sjc-gold-binhnguyensoft-com.gschema.xml"
)
SCHEMA_ID = "org.gnome.shell.extensions.sjc-gold-binhnguyensoft-com"
SCHEMA_SETTINGS_PATH = "/org/gnome/shell/extensions/sjc-gold-binhnguyensoft-com/"
CONTRACTS = {
    "left": {"default": 15, "minimum": 0, "maximum": 10000},
    "top": {"default": 15, "minimum": 0, "maximum": 10000},
    "duration": {"default": 5, "minimum": 5, "maximum": 300},
}


class SchemaContracts(unittest.TestCase):
    def setUp(self):
        self.root = ET.parse(SCHEMA_PATH).getroot()
        schemas = self.root.findall("schema")
        self.assertEqual(self.root.tag, "schemalist")
        self.assertEqual(len(schemas), 1)
        self.schema = schemas[0]
        self.keys = self.schema.findall("key")

    def test_schema_identity_matches_extension_metadata(self):
        metadata = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(self.schema.get("id"), SCHEMA_ID)
        self.assertEqual(metadata["settings-schema"], SCHEMA_ID)

    def test_schema_has_fixed_settings_path(self):
        self.assertEqual(self.schema.get("path"), SCHEMA_SETTINGS_PATH)

    def test_exact_keys_are_unique(self):
        names = [key.get("name") for key in self.keys]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), set(CONTRACTS))

    def test_settings_are_signed_32_bit_integers(self):
        for key in self.keys:
            with self.subTest(key=key.get("name")):
                self.assertEqual(key.get("type"), "i")

    def test_default_positions_and_refresh_minutes(self):
        for key in self.keys:
            name = key.get("name")
            with self.subTest(key=name):
                defaults = key.findall("default")
                self.assertEqual(len(defaults), 1)
                self.assertEqual(int(defaults[0].text), CONTRACTS[name]["default"])

    def test_position_and_refresh_limits(self):
        for key in self.keys:
            name = key.get("name")
            with self.subTest(key=name):
                ranges = key.findall("range")
                self.assertEqual(len(ranges), 1)
                self.assertEqual(int(ranges[0].get("min")), CONTRACTS[name]["minimum"])
                self.assertEqual(int(ranges[0].get("max")), CONTRACTS[name]["maximum"])

    def test_defaults_are_inside_inclusive_ranges(self):
        for key in self.keys:
            with self.subTest(key=key.get("name")):
                default = int(key.find("default").text)
                limits = key.find("range")
                self.assertLessEqual(int(limits.get("min")), default)
                self.assertLessEqual(default, int(limits.get("max")))

    def test_preferences_have_nonempty_labels_and_descriptions(self):
        for key in self.keys:
            for tag in ("summary", "description"):
                with self.subTest(key=key.get("name"), field=tag):
                    fields = key.findall(tag)
                    self.assertEqual(len(fields), 1)
                    self.assertTrue((fields[0].text or "").strip())


if __name__ == "__main__":
    unittest.main()
