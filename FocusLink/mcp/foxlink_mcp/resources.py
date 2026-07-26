from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

from .client import FoxlinkClient


def register_resources(mcp: FastMCP, client: FoxlinkClient) -> None:
    @mcp.resource(
        "foxlink://sessions/recent", name="Foxlink recent sessions", mime_type="application/json"
    )
    async def _recent_sessions() -> str:  # pyright: ignore[reportUnusedFunction]
        return json.dumps(await client.request("GET", "/v1/sessions?limit=200"), ensure_ascii=False)

    @mcp.resource(
        "foxlink://sessions/{session_id}",
        name="Foxlink session detail",
        mime_type="application/json",
    )
    async def _session_detail(  # pyright: ignore[reportUnusedFunction]
        session_id: str,
    ) -> str:
        return json.dumps(await client.session(session_id), ensure_ascii=False)

    @mcp.resource(
        "foxlink://analytics/today", name="Foxlink today summary", mime_type="application/json"
    )
    async def _today_summary() -> str:  # pyright: ignore[reportUnusedFunction]
        return json.dumps(await client.request("GET", "/v1/analytics/today"), ensure_ascii=False)

    @mcp.resource(
        "foxlink://capabilities", name="Foxlink capabilities", mime_type="application/json"
    )
    async def _capabilities() -> str:  # pyright: ignore[reportUnusedFunction]
        return json.dumps(await client.request("GET", "/v1/capabilities"), ensure_ascii=False)
