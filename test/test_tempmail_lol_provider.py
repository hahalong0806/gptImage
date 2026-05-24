import os
import unittest

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.register.mail_provider import TempMailLolProvider


class FakeResponse:
    def __init__(self, status_code: int, data):
        self.status_code = status_code
        self._data = data
        self.text = "{}" if data is None else str(data)

    def json(self):
        return self._data


class FakeSession:
    def __init__(self):
        self.headers = {}
        self.trust_env = False
        self.proxies = {}
        self.requests = []

    def request(self, method, url, params=None, json=None, timeout=None, verify=None):
        self.requests.append((method, url, params or {}, json or {}, dict(self.headers)))
        if method == "POST" and url.endswith("/inbox/create"):
            return FakeResponse(201, {"address": "free@example.lol", "token": "free-token"})
        if method == "GET" and url.endswith("/inbox"):
            return FakeResponse(200, {
                "emails": [{
                    "id": "email-1",
                    "subject": "Verify",
                    "from": "noreply@example.com",
                    "body": "Verification code: 654321",
                    "created_at": "2026-05-24T00:00:00Z",
                }]
            })
        raise AssertionError(f"unexpected request: {method} {url}")

    def close(self):
        pass


class TempMailLolProviderTests(unittest.TestCase):
    def test_free_inbox_does_not_require_api_key(self):
        provider = TempMailLolProvider(
            {"provider_ref": "tempmail_lol#1", "api_base": "https://api.tempmail.lol/v2", "api_key": "", "domain": []},
            {"request_timeout": 1, "wait_timeout": 1, "wait_interval": 0.2, "user_agent": "test-agent", "proxy": ""},
        )
        session = FakeSession()
        provider.session = session
        provider.session.headers.update({"User-Agent": "test-agent", "Accept": "application/json", "Content-Type": "application/json"})

        mailbox = provider.create_mailbox()
        code = provider.wait_for_code(mailbox)

        self.assertEqual(mailbox["provider"], "tempmail_lol")
        self.assertEqual(mailbox["address"], "free@example.lol")
        self.assertEqual(mailbox["token"], "free-token")
        self.assertEqual(code, "654321")
        self.assertNotIn("Authorization", session.requests[0][4])


if __name__ == "__main__":
    unittest.main()
