from pathlib import Path

from starlette.testclient import TestClient

from foxlink_mcp.server import build_server
from foxlink_mcp.settings import Settings


def test_health_endpoint_is_independent_of_business_process(tmp_path: Path) -> None:
    app, _, _ = build_server(Settings(data_dir=tmp_path))
    with TestClient(app) as test:
        response = test.get("/healthz")
        assert response.status_code == 200
        assert response.json()["service"] == "PoyiFoxlinkMcp"
