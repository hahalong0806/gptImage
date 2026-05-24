import os
import unittest

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from starlette.datastructures import Headers, URL

from api.support import resolve_image_base_url


class FakeRequest:
    def __init__(self, headers: dict[str, str], url: str):
        self.headers = Headers(headers)
        self.url = URL(url)


class ImageBaseUrlTests(unittest.TestCase):
    def test_uses_forwarded_https_proto(self):
        request = FakeRequest(
            {
                "host": "huluwahuang-gptimage.hf.space",
                "x-forwarded-proto": "https",
            },
            "http://huluwahuang-gptimage.hf.space/api/images",
        )

        self.assertEqual(resolve_image_base_url(request), "https://huluwahuang-gptimage.hf.space")

    def test_uses_forwarded_host(self):
        request = FakeRequest(
            {
                "host": "internal:7860",
                "x-forwarded-host": "huluwahuang-gptimage.hf.space",
                "x-forwarded-proto": "https",
            },
            "http://internal:7860/api/images",
        )

        self.assertEqual(resolve_image_base_url(request), "https://huluwahuang-gptimage.hf.space")


if __name__ == "__main__":
    unittest.main()
