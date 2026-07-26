from __future__ import annotations

from typing import Any, cast

from mcp.server.fastmcp import FastMCP

from .audit import record
from .client import FoxlinkClient
from .errors import FoxlinkError


def envelope(data: Any, *, resource_uri: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"ok": True, "data": data}
    if resource_uri:
        value["resourceUri"] = resource_uri
    return value


def register_tools(mcp: FastMCP, client: FoxlinkClient) -> None:
    @mcp.tool(
        name="foxlink_get_status", description="Get Foxlink service, version, and timer status"
    )
    async def _get_status() -> dict[str, Any]:  # pyright: ignore[reportUnusedFunction]
        return envelope(await client.status())

    @mcp.tool(
        name="foxlink_get_current_session",
        description="Get the current Foxlink focus timer snapshot",
    )
    async def _get_current_session() -> dict[str, Any]:  # pyright: ignore[reportUnusedFunction]
        return envelope(await client.request("GET", "/v1/focus/current"))

    @mcp.tool(
        name="foxlink_list_sessions",
        description="List compact recent Foxlink session summaries; use the resource for large history",
    )
    async def _list_sessions(  # pyright: ignore[reportUnusedFunction]
        limit: int = 20,
    ) -> dict[str, Any]:
        bounded = max(1, min(50, limit))
        data = cast(dict[str, Any], await client.request("GET", f"/v1/sessions?limit={bounded}"))
        return envelope(data, resource_uri="foxlink://sessions/recent")

    @mcp.tool(
        name="foxlink_get_session",
        description="Get one Foxlink session and its segments and pauses",
    )
    async def _get_session(  # pyright: ignore[reportUnusedFunction]
        session_id: str,
    ) -> dict[str, Any]:
        return envelope(
            await client.session(session_id), resource_uri=f"foxlink://sessions/{session_id}"
        )

    @mcp.tool(name="foxlink_get_today_summary", description="Get today's Foxlink focus totals")
    async def _get_today_summary() -> dict[str, Any]:  # pyright: ignore[reportUnusedFunction]
        return envelope(await client.request("GET", "/v1/analytics/today"))

    async def control(
        action: str,
        request_id: str,
        command_id: str,
        expected_revision: int,
        expected_state: str,
        expires_at: int,
    ) -> dict[str, Any]:
        payload = {
            "requestId": request_id,
            "commandId": command_id,
            "expectedRevision": expected_revision,
            "expectedState": expected_state,
            "expiresAt": expires_at,
        }
        try:
            result = await client.request("POST", f"/v1/focus/{action}", payload)
            record(f"foxlink_{action}_focus", ok=True)
            return envelope(result)
        except FoxlinkError as exc:
            record(f"foxlink_{action}_focus", ok=False, code=exc.code)
            raise

    @mcp.tool(
        name="foxlink_start_focus",
        description="Start Foxlink focus with revision, state, expiry, and replay protection",
    )
    async def _start_focus(  # pyright: ignore[reportUnusedFunction]
        requestId: str, commandId: str, expectedRevision: int, expectedState: str, expiresAt: int
    ) -> dict[str, Any]:
        return await control(
            "start", requestId, commandId, expectedRevision, expectedState, expiresAt
        )

    @mcp.tool(
        name="foxlink_pause_focus",
        description="Pause Foxlink focus with revision, state, expiry, and replay protection",
    )
    async def _pause_focus(  # pyright: ignore[reportUnusedFunction]
        requestId: str, commandId: str, expectedRevision: int, expectedState: str, expiresAt: int
    ) -> dict[str, Any]:
        return await control(
            "pause", requestId, commandId, expectedRevision, expectedState, expiresAt
        )

    @mcp.tool(
        name="foxlink_resume_focus",
        description="Resume Foxlink focus with revision, state, expiry, and replay protection",
    )
    async def _resume_focus(  # pyright: ignore[reportUnusedFunction]
        requestId: str, commandId: str, expectedRevision: int, expectedState: str, expiresAt: int
    ) -> dict[str, Any]:
        return await control(
            "resume", requestId, commandId, expectedRevision, expectedState, expiresAt
        )

    @mcp.tool(
        name="foxlink_stop_focus",
        description="Stop and save Foxlink focus with revision, state, expiry, and replay protection",
    )
    async def _stop_focus(  # pyright: ignore[reportUnusedFunction]
        requestId: str, commandId: str, expectedRevision: int, expectedState: str, expiresAt: int
    ) -> dict[str, Any]:
        return await control(
            "stop", requestId, commandId, expectedRevision, expectedState, expiresAt
        )
