import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from match import assign_voices, write_page


class AssignmentTests(unittest.TestCase):
    def test_excludes_accents_and_computer_voices(self):
        for service, banned, computer, allowed in [
            ("kokoro", ["ff_siwis", "hf_beta", "if_sara"], "af_alloy", "af_nova"),
            ("mai", ["en-IN-Priya__neutral"], "en-US-Iris__neutral", "en-AU-Isla__neutral"),
        ]:
            ranking = {"crusher": [
                {"voice": voice, "score": 10} for voice in [*banned, computer]
            ] + [{"voice": allowed, "score": 1}]}
            self.assertEqual(assign_voices(service, ranking, ["crusher"]), {"crusher": allowed})

    def test_chooses_distinct_voices(self):
        ranking = {
            "riker": [{"voice": "en-US-Ethan", "score": 2}, {"voice": "en-GB-Harry", "score": 0}],
            "worf": [{"voice": "en-US-Ethan", "score": 2}, {"voice": "en-GB-Harry", "score": 1}],
        }
        self.assertEqual(assign_voices("mai", ranking, ["riker", "worf"]),
                         {"riker": "en-US-Ethan", "worf": "en-GB-Harry"})

    def test_reports_insufficient_voices(self):
        with self.assertRaisesRegex(ValueError, "Not enough distinct"):
            assign_voices("mai", {"worf": [{"voice": "en-IN-Dhruv", "score": 1}]}, ["worf"])

    def test_listening_page_starts_with_chosen_voice_and_excludes_banned_voices(self):
        picks = {"kokoro": {
            "assigned": {"crusher": "af_nova"},
            "ranking": {"crusher": [
                {"voice": "ff_siwis", "score": 3},
                {"voice": "af_heart", "score": 2},
                {"voice": "af_nova", "score": 1},
            ]},
        }}
        with TemporaryDirectory() as directory:
            page = Path(directory) / "listen.html"
            write_page(page, Path(directory), picks, {"crusher": {"officer": True}})
            content = page.read_text()
            self.assertNotIn("ff_siwis", content)
            self.assertLess(content.index('src="samples/kokoro/af_nova.wav"'),
                            content.index('src="samples/kokoro/af_heart.wav"'))


if __name__ == "__main__":
    unittest.main()
