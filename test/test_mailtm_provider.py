import os
import unittest

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.register.mail_provider import MailTmProvider


class FakeResponse:
    def __init__(self, status_code: int, data):
        self.status_code = status_code
        self._data = data
        self.text = "{}" if data is None else str(data)

    def json(self):
        return self._data


class FakeSession:
    def __init__(self, address: str):
        self.address = address
        self.headers = {}
        self.trust_env = False
        self.proxies = {}
        self.requests = []

    def request(self, method, url, headers=None, params=None, json=None, timeout=None, verify=None):
        self.requests.append((method, url, headers or {}, params or {}, json or {}))
        if method == "POST" and url.endswith("/accounts"):
            return FakeResponse(201, {"address": json["address"]})
        if method == "POST" and url.endswith("/token"):
            return FakeResponse(200, {"token": "mailtm-token"})
        if method == "GET" and url.endswith("/messages"):
            return FakeResponse(200, {"hydra:member": [{"id": "message-1", "subject": "Verify", "createdAt": "2026-05-24T00:00:00Z"}]})
        if method == "GET" and url.endswith("/messages/message-1"):
            return FakeResponse(200, {
                "id": "message-1",
                "subject": "Verify",
                "from": {"address": "noreply@example.com"},
                "to": [{"address": self.address}],
                "text": "Verification code: 123456",
                "html": ["<p>Verification code: 123456</p>"],
                "createdAt": "2026-05-24T00:00:00Z",
            })
        raise AssertionError(f"unexpected request: {method} {url}")

    def close(self):
        pass


class MailTmProviderTests(unittest.TestCase):
    def test_create_mailbox_and_wait_for_code(self):
        provider = MailTmProvider(
            {"provider_ref": "mailtm#1", "api_base": "https://api.mail.tm", "domain": ["example.test"]},
            {"request_timeout": 1, "wait_timeout": 1, "wait_interval": 0.2, "user_agent": "test-agent", "proxy": ""},
        )
        provider.session = FakeSession("alice@example.test")

        mailbox = provider.create_mailbox("alice")
        code = provider.wait_for_code(mailbox)

        self.assertEqual(mailbox["provider"], "mailtm")
        self.assertEqual(mailbox["address"], "alice@example.test")
        self.assertEqual(mailbox["token"], "mailtm-token")
        self.assertEqual(code, "123456")


if __name__ == "__main__":
    unittest.main()
