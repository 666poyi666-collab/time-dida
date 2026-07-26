from __future__ import annotations

import asyncio
from collections.abc import Generator
from contextlib import contextmanager

import servicemanager
import uvicorn
import win32event
import win32service
import win32serviceutil

from .server import build_server
from .settings import Settings


class ServiceUvicornServer(uvicorn.Server):
    @contextmanager
    def capture_signals(self) -> Generator[None, None, None]:
        yield


class FoxlinkMcpService(win32serviceutil.ServiceFramework):
    _svc_name_ = "PoyiFoxlinkMcp"
    _svc_display_name_ = "Poyi Foxlink MCP"
    _svc_description_ = "Independent local MCP server for Foxlink."

    def __init__(self, args: list[str]) -> None:
        super().__init__(args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.server: uvicorn.Server | None = None

    def SvcStop(self) -> None:
        self.ReportServiceStatus(  # pyright: ignore[reportUnknownMemberType]
            win32service.SERVICE_STOP_PENDING
        )
        if self.server is not None:
            self.server.should_exit = True
        win32event.SetEvent(self.stop_event)

    def SvcDoRun(self) -> None:
        servicemanager.LogInfoMsg("PoyiFoxlinkMcp starting")
        settings = Settings()
        app, _, _ = build_server(settings)
        self.server = ServiceUvicornServer(
            uvicorn.Config(app, host=settings.host, port=settings.port, log_config=None)
        )
        loop = asyncio.SelectorEventLoop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self.server.serve())
        finally:
            loop.close()
        servicemanager.LogInfoMsg("PoyiFoxlinkMcp stopped")


if __name__ == "__main__":
    win32serviceutil.HandleCommandLine(  # pyright: ignore[reportUnknownMemberType]
        FoxlinkMcpService,
        serviceClassString="foxlink_mcp.windows_service.FoxlinkMcpService",
    )
