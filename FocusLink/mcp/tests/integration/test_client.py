from pathlib import Path

import httpx
import pytest
import respx

from foxlink_mcp.client import FoxlinkClient
from foxlink_mcp.errors import FoxlinkError
from foxlink_mcp.settings import Settings


@pytest.mark.asyncio
async def test_client_auth_and_control_error_mapping(tmp_path: Path) -> None:
    (tmp_path / "business-api-token").write_text("x" * 48, encoding="utf-8")
    client = FoxlinkClient(Settings(data_dir=tmp_path))
    with respx.mock(base_url="http://127.0.0.1:18770") as mock:
        route = mock.post("/v1/focus/pause").mock(
            return_value=httpx.Response(
                409,
                json={
                    "error": {
                        "code": "REVISION_CONFLICT",
                        "message": "changed",
                        "details": {"actualRevision": 4},
                    }
                },
            )
        )
        with pytest.raises(FoxlinkError) as caught:
            await client.request("POST", "/v1/focus/pause", {"requestId": "request-1"})
        assert caught.value.code == "REVISION_CONFLICT"
        assert route.calls[0].request.headers["authorization"] == "Bearer " + "x" * 48
    await client.close()
