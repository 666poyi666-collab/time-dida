from __future__ import annotations

import argparse
import asyncio
import json

import uvicorn

from .server import build_server
from .settings import Settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="foxlink-mcp")
    parser.add_argument("command", choices=["serve", "stdio", "doctor"], nargs="?", default="serve")
    args = parser.parse_args()
    settings = Settings()
    app, mcp, client = build_server(settings)
    if args.command == "serve":
        uvicorn.run(app, host=settings.host, port=settings.port, log_config=None)
    elif args.command == "stdio":
        mcp.run("stdio")
    else:

        async def doctor() -> None:
            status = await client.status()
            print(
                json.dumps(
                    {
                        "service": "PoyiFoxlinkMcp",
                        "mcp": f"http://{settings.host}:{settings.port}/mcp",
                        "business": settings.business_url,
                        "foxlink": status.get("version"),
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            await client.close()

        asyncio.run(doctor())


if __name__ == "__main__":
    main()
