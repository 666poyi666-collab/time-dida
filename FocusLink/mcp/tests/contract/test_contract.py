from pathlib import Path

from foxlink_mcp.server import build_server
from foxlink_mcp.settings import Settings


def test_namespaced_tools_and_resources(tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path)
    _, mcp, _ = build_server(settings)
    names = [tool.name for tool in mcp._tool_manager.list_tools()]
    assert names == [
        "foxlink_get_status",
        "foxlink_get_current_session",
        "foxlink_list_sessions",
        "foxlink_get_session",
        "foxlink_get_today_summary",
        "foxlink_start_focus",
        "foxlink_pause_focus",
        "foxlink_resume_focus",
        "foxlink_stop_focus",
    ]
    assert all(name.startswith("foxlink_") for name in names)
