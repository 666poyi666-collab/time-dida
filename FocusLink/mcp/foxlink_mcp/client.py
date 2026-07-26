from __future__ import annotations

import hmac
from typing import Any, cast
from urllib.parse import quote

import httpx

from .errors import FoxlinkError
from .settings import Settings


class FoxlinkClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = httpx.AsyncClient(base_url=settings.business_url, timeout=15)

    def _token(self) -> str:
        try:
            token = self.settings.token_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise FoxlinkError(
                "FOXLINK_CREDENTIAL_MISSING", "Foxlink API credential is missing"
            ) from exc
        if len(token) < 32:
            raise FoxlinkError("FOXLINK_CREDENTIAL_INVALID", "Foxlink API credential is invalid")
        return token

    async def close(self) -> None:
        await self._client.aclose()

    async def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        try:
            response = await self._client.request(
                method, path, json=payload, headers={"Authorization": f"Bearer {self._token()}"}
            )
        except httpx.TimeoutException as exc:
            raise FoxlinkError("FOXLINK_TIMEOUT", "Foxlink did not respond in time") from exc
        except httpx.NetworkError as exc:
            raise FoxlinkError("FOXLINK_UNAVAILABLE", "Foxlink is not running") from exc
        try:
            value: Any = response.json()
        except ValueError as exc:
            raise FoxlinkError("FOXLINK_PROTOCOL_ERROR", "Foxlink returned invalid JSON") from exc
        if response.status_code >= 400:
            body = cast(dict[str, Any], value) if isinstance(value, dict) else {}
            raw = body.get("error", {})
            error = cast(dict[str, Any], raw) if isinstance(raw, dict) else {}
            raise FoxlinkError(
                str(error.get("code", "FOXLINK_ERROR")),
                str(error.get("message", "Foxlink rejected the request")),
                details=cast(dict[str, Any], error.get("details", {}))
                if isinstance(error.get("details"), dict)
                else {},
            )
        return value

    async def status(self) -> dict[str, Any]:
        value = await self.request("GET", "/v1/status")
        if not isinstance(value, dict):
            raise FoxlinkError("FOXLINK_PROTOCOL_ERROR", "Status must be an object")
        return cast(dict[str, Any], value)

    async def session(self, session_id: str) -> dict[str, Any]:
        value = await self.request("GET", f"/v1/sessions/{quote(session_id, safe='')}")
        return cast(dict[str, Any], value)


def secrets_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)
