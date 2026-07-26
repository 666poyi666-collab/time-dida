from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("foxlink_mcp.audit")


def record(event: str, *, ok: bool, code: str | None = None) -> None:
    logger.info(json.dumps({"event": event, "ok": ok, "code": code}, separators=(",", ":")))


def redact(_: Any) -> str:
    return "[REDACTED]"
