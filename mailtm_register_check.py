import argparse
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
import uuid


MAIL_API_BASE = os.environ.get("MAIL_API_BASE", "https://api.mail.tm").rstrip("/")
MAIL_API_DOMAIN = os.environ.get("MAIL_API_DOMAIN", "").strip()


def mail_headers(extra=None):
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
    }
    if extra:
        headers.update(extra)
    return headers


def request_json(url, headers=None, method="GET", json_body=None, timeout=20):
    method = (method or "GET").upper()
    body = None
    req_headers = dict(headers or {})
    if json_body is not None:
        body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")

    try:
        req = urllib.request.Request(url, headers=req_headers, data=body, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            return json.loads(text), response.status, text
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = None
        return data, exc.code, text
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid json from {url}: {exc}") from exc


def pick_domain():
    data, status, text = request_json(f"{MAIL_API_BASE}/domains", mail_headers())
    if status < 200 or status >= 300:
        raise RuntimeError(f"mail.tm domains failed: status={status} body={text}")

    if isinstance(data, list):
        domains = data
    elif isinstance(data, dict):
        domains = data.get("hydra:member", []) or data.get("data", []) or []
    else:
        domains = []

    if not domains:
        raise RuntimeError("mail.tm domains empty")

    preferred = MAIL_API_DOMAIN.lower()
    if preferred:
        for item in domains:
            domain = str(item.get("domain") or "").strip().lower()
            if domain == preferred and item.get("isActive", True):
                return domain
        raise RuntimeError(f"mail.tm preferred domain unavailable: {MAIL_API_DOMAIN}")

    for item in domains:
        domain = str(item.get("domain") or "").strip().lower()
        if domain and item.get("isActive", True):
            return domain

    raise RuntimeError("mail.tm has no active domain")


def register_email(attempts=8):
    domain = pick_domain()
    last_error = None

    for i in range(attempts):
        password = secrets.token_urlsafe(18)
        address = f"{uuid.uuid4().hex[:12]}@{domain}"

        create_data, create_status, create_text = request_json(
            f"{MAIL_API_BASE}/accounts",
            mail_headers(),
            method="POST",
            json_body={"address": address, "password": password},
        )
        if create_status not in (200, 201):
            last_error = f"account create failed: status={create_status} body={create_text}"
            if create_status == 422:
                time.sleep(1)
                continue
            if create_status == 429:
                time.sleep(2 + i)
                continue
            time.sleep(i + 2)
            continue

        created_address = str((create_data or {}).get("address") or address).strip()
        token_data, token_status, token_text = request_json(
            f"{MAIL_API_BASE}/token",
            mail_headers(),
            method="POST",
            json_body={"address": created_address, "password": password},
        )
        token = str((token_data or {}).get("token") or "").strip()
        if token_status not in (200, 201) or not token:
            last_error = f"token failed: status={token_status} body={token_text}"
            if token_status == 429:
                time.sleep(2 + i)
                continue
            time.sleep(i + 2)
            continue

        return {
            "email": created_address,
            "password": password,
            "token": token,
            "domain": domain,
        }

    raise RuntimeError(last_error or "Failed to register mail.tm email")


def parse_args():
    parser = argparse.ArgumentParser(description="Register one temporary email with api.mail.tm.")
    parser.add_argument("--mail-api-base", default=MAIL_API_BASE, help="Default: https://api.mail.tm")
    parser.add_argument("--domain", default=MAIL_API_DOMAIN, help="Preferred mail.tm domain.")
    parser.add_argument("--attempts", type=int, default=8, help="Registration retry attempts.")
    parser.add_argument("--show-token", action="store_true", help="Also print password and token.")
    return parser.parse_args()


def main():
    global MAIL_API_BASE, MAIL_API_DOMAIN
    args = parse_args()
    MAIL_API_BASE = args.mail_api_base.rstrip("/")
    MAIL_API_DOMAIN = args.domain.strip()

    account = register_email(attempts=args.attempts)
    print(f"EMAIL={account['email']}")
    if args.show_token:
        print(f"PASSWORD={account['password']}")
        print(f"TOKEN={account['token']}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
