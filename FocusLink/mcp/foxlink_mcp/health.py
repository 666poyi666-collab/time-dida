from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

from .client import FoxlinkClient
from .errors import FoxlinkError


class Health:
    def __init__(self, client: FoxlinkClient) -> None:
        self.client = client
        self.calls = 0
        self.failures = 0

    async def healthz(self, _: Request) -> JSONResponse:
        return JSONResponse({"service": "PoyiFoxlinkMcp", "status": "alive", "version": "0.1.0"})

    async def readyz(self, _: Request) -> JSONResponse:
        try:
            status = await self.client.status()
            return JSONResponse(
                {
                    "service": "PoyiFoxlinkMcp",
                    "status": "ready",
                    "foxlink": "available",
                    "version": status.get("version"),
                }
            )
        except FoxlinkError:
            return JSONResponse(
                {"service": "PoyiFoxlinkMcp", "status": "degraded", "foxlink": "unavailable"},
                status_code=503,
            )

    async def metrics(self, _: Request) -> PlainTextResponse:
        return PlainTextResponse(
            "# TYPE foxlink_mcp_up gauge\nfoxlink_mcp_up 1\n"
            "# TYPE foxlink_mcp_tool_calls_total counter\n"
            f"foxlink_mcp_tool_calls_total {self.calls}\n"
            "# TYPE foxlink_mcp_tool_failures_total counter\n"
            f"foxlink_mcp_tool_failures_total {self.failures}\n",
            media_type="text/plain; version=0.0.4",
        )
