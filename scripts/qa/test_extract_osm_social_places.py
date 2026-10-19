import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("extract-osm-social-places.py")
SPEC = importlib.util.spec_from_file_location("extract_osm_social_places", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OSMPlaceExtractionTests(unittest.TestCase):
    def test_classifies_gym_and_city_tags_without_guessing_from_names(self):
        self.assertEqual(MODULE.classify_tags({"amenity": "gym", "name": "Atlas"}), {"GYM"})
        self.assertEqual(MODULE.classify_tags({"leisure": "fitness_centre", "name": "Atlas"}), {"GYM"})
        self.assertEqual(MODULE.classify_tags({"place": "town", "name": "Viacha"}), {"CITY"})
        self.assertEqual(MODULE.classify_tags({"name": "Gym Santa Cruz"}), set())

    def test_area_center_uses_valid_bounded_coordinates(self):
        self.assertEqual(
            MODULE.area_center([(0.0, 0.0), (0.0, 2.0), (2.0, 2.0), (2.0, 0.0)]),
            {"latitude": 1.0, "longitude": 1.0},
        )
        self.assertIsNone(MODULE.area_center([(90.0, 0.0), (91.0, 1.0)]))
        self.assertIsNone(MODULE.area_center([]))

    def test_builds_stable_provenance_ids_for_both_osm_object_types(self):
        self.assertEqual(MODULE.source_id("node", 321), "node/321")
        self.assertEqual(MODULE.source_id("way", 321), "way/321")
        self.assertNotEqual(MODULE.source_id("way", 321), MODULE.source_id("relation", 321))


if __name__ == "__main__":
    unittest.main()
