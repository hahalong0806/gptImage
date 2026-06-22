from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

BASE_DIR = Path(__file__).resolve().parent
PAYLOAD_ZIP = BASE_DIR / "payload.zip"
REQUIREMENTS_FILE = BASE_DIR / "requirements.txt"
ROOT_CONFIG_FILE = BASE_DIR / "config.json"
AUTH_KEY_FILE = BASE_DIR / "auth-key.txt"
RUNTIME_DIR = BASE_DIR / ".vortexa_runtime"
APP_DIR = RUNTIME_DIR / "app"
MARKER_FILE = RUNTIME_DIR / "payload.sha256"
DATA_DIR = BASE_DIR / "data"
DEFAULT_AUTH_KEY = "a123456789"


def _resolve_port() -> int:
    for name in ("PORT", "SERVER_PORT", "APP_PORT"):
        value = str(os.getenv(name) or "").strip()
        if not value:
            continue
        try:
            return int(value)
        except ValueError:
            print(f"[vortexa] ignore invalid {name}={value!r}")
    return 80


def _safe_rmtree(path: Path) -> None:
    if not path.exists():
        return
    resolved = path.resolve()
    resolved.relative_to(RUNTIME_DIR.resolve())
    shutil.rmtree(resolved)


def _payload_hash() -> str:
    if not PAYLOAD_ZIP.is_file():
        raise RuntimeError("payload.zip not found next to app.py")
    digest = hashlib.sha256()
    with PAYLOAD_ZIP.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract_payload() -> None:
    payload_hash = _payload_hash()
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    if APP_DIR.exists() and MARKER_FILE.exists() and MARKER_FILE.read_text(encoding="utf-8").strip() == payload_hash:
        return

    _safe_rmtree(APP_DIR)
    APP_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(PAYLOAD_ZIP) as archive:
        base = APP_DIR.resolve()
        for item in archive.infolist():
            normalized_name = item.filename.replace("\\", "/").lstrip("/")
            target = (APP_DIR / normalized_name).resolve()
            target.relative_to(base)
        for item in archive.infolist():
            normalized_name = item.filename.replace("\\", "/").lstrip("/")
            if not normalized_name or normalized_name.endswith("/"):
                continue
            target = (APP_DIR / normalized_name).resolve()
            target.relative_to(base)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(item) as source, target.open("wb") as destination:
                shutil.copyfileobj(source, destination)
    MARKER_FILE.write_text(payload_hash + "\n", encoding="utf-8")
    print(f"[vortexa] extracted payload.zip to {APP_DIR}")


def _ensure_dependencies() -> None:
    missing_modules = ("fastapi", "uvicorn", "curl_cffi", "PIL", "pybase64", "multipart", "tiktoken", "sqlalchemy")
    if all(importlib.util.find_spec(module) is not None for module in missing_modules):
        return
    if not REQUIREMENTS_FILE.is_file():
        print("[vortexa] dependencies are missing and requirements.txt was not found")
        return
    print("[vortexa] installing missing Python dependencies from requirements.txt")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "-r", str(REQUIREMENTS_FILE)])


def _set_defaults() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not str(os.getenv("CHATGPT2API_AUTH_KEY") or "").strip() and AUTH_KEY_FILE.is_file():
        auth_key = AUTH_KEY_FILE.read_text(encoding="utf-8").strip()
        if auth_key:
            os.environ["CHATGPT2API_AUTH_KEY"] = auth_key
    if not str(os.getenv("CHATGPT2API_AUTH_KEY") or "").strip():
        os.environ["CHATGPT2API_AUTH_KEY"] = DEFAULT_AUTH_KEY
    os.environ.setdefault("CHATGPT2API_DATA_DIR", str(DATA_DIR))
    config_file = ROOT_CONFIG_FILE if ROOT_CONFIG_FILE.is_file() else DATA_DIR / "config.json"
    os.environ.setdefault("CHATGPT2API_CONFIG_FILE", str(config_file))


_ensure_dependencies()
_extract_payload()
_set_defaults()
sys.path.insert(0, str(APP_DIR))

from main import app  # noqa: E402


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=_resolve_port(), access_log=True, log_level="info")
