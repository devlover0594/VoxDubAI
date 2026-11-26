import unittest
from unittest.mock import patch

from analyze_media import (
    AnalysisError,
    _normalize_segments,
    _resolve_model,
    _validate_base_url,
    analyze,
)


class AnalyzeMediaTests(unittest.TestCase):
    def test_normalize_segments_preserves_timestamps_and_clamps_word_times(self):
        segments = _normalize_segments(
            [
                {
                    "id": 3,
                    "startTime": "00:00:02.500",
                    "endTime": "4.5",
                    "originalText": "  hello  ",
                    "translatedText": " halo ",
                    "words": [{"word": "halo", "start": 1, "end": 8}],
                }
            ]
        )

        self.assertEqual(segments[0]["startTime"], "00:00:02.500")
        self.assertEqual(segments[0]["endTime"], "00:00:04.500")
        self.assertEqual(segments[0]["originalText"], "hello")
        self.assertEqual(segments[0]["translatedText"], "halo")
        self.assertEqual(segments[0]["words"], [{"word": "halo", "start": 2.5, "end": 4.5}])

    def test_model_resolution_uses_provider_default_for_auto(self):
        self.assertEqual(_resolve_model("groq", "auto"), "llama-3.3-70b-versatile")
        self.assertEqual(_resolve_model("openai", "gpt-4o-mini"), "gpt-4o-mini")

    def test_base_url_validation_rejects_local_targets(self):
        for url in (
            "http://api.openai.com/v1",
            "https://localhost/v1",
            "https://127.0.0.1/v1",
            "https://169.254.169.254/latest",
        ):
            with self.subTest(url=url), self.assertRaises(AnalysisError):
                _validate_base_url(url)

        self.assertEqual(_validate_base_url("https://8.8.8.8/v1"), "https://8.8.8.8/v1")

    def test_analyze_uses_fallback_provider_after_primary_failure(self):
        candidates = [
            {"provider": "openai", "baseUrl": "https://api.openai.com/v1", "apiKey": "bad", "model": "gpt-4o"},
            {"provider": "groq", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "good", "model": "llama-3.3"},
        ]
        result_segments = [
            {
                "id": 1,
                "startTime": "00:00:00.000",
                "endTime": "00:00:02.000",
                "originalText": "hello",
                "translatedText": "halo",
                "words": [],
            }
        ]
        with patch(
            "analyze_media._analyze_candidate",
            side_effect=[AnalysisError("HTTP 429 rate limit"), (result_segments, "llama-3.3")],
        ):
            result = analyze(
                {
                    "candidates": candidates,
                    "sourceLabel": "English",
                    "targetLabel": "Indonesian",
                    "media": {"filePath": "unused", "fileSize": 5, "originalName": "x.mp4", "mimeType": "video/mp4"},
                }
            )

        self.assertTrue(result["ok"])
        self.assertTrue(result["fallbackUsed"])
        self.assertEqual(result["attemptCount"], 2)
        self.assertEqual(result["usedProvider"], "Groq")
        self.assertEqual(result["segments"], result_segments)

    def test_analyze_reports_mapped_error_after_all_candidates_fail(self):
        candidates = [
            {"provider": "openai"},
            {"provider": "groq"},
        ]
        with patch(
            "analyze_media._analyze_candidate",
            side_effect=[AnalysisError("401 Unauthorized"), AnalysisError("503 unavailable")],
        ):
            result = analyze(
                {
                    "candidates": candidates,
                    "sourceLabel": "English",
                    "targetLabel": "Indonesian",
                    "media": {"filePath": "unused", "fileSize": 5, "originalName": "x.mp4", "mimeType": "video/mp4"},
                }
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["httpStatus"], 429)
        self.assertIn("Semua 2 konfigurasi AI gagal", result["error"])
        self.assertNotIn("bad", result["error"])


if __name__ == "__main__":
    unittest.main()
