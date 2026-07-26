from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from starlette.routing import Route

from .client import FoxlinkClient
from .health import Health
from .resources import register_resources
from .settings import Settings
from .tools import register_tools


def build_server(settings: Settings | None = None):
    config = settings or Settings()
    client = FoxlinkClient(config)
    mcp = FastMCP(
        name="Foxlink",
        stateless_http=True,
        json_response=True,
        host=config.host,
        port=config.port,
        streamable_http_path="/mcp",
    )
    register_tools(mcp, client)
    register_resources(mcp, client)
    app = mcp.streamable_http_app()
    health = Health(client)
    app.routes[0:0] = [
        Route("/healthz", health.healthz),
        Route("/readyz", health.readyz),
        Route("/metrics", health.metrics),
    ]
    return app, mcp, client
