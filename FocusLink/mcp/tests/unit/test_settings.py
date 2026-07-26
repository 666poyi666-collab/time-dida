from foxlink_mcp.settings import Settings


def test_independent_ports_and_loopback() -> None:
    value = Settings()
    assert value.host == "127.0.0.1"
    assert value.port == 8770
    assert value.business_url == "http://127.0.0.1:18770"
