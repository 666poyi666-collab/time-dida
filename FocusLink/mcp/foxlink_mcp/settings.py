from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8770
    business_url: str = "http://127.0.0.1:18770"
    data_dir: Path = Path(os.environ.get("FOXLINK_MCP_DATA_DIR", r"C:\ProgramData\Poyi\FoxlinkMcp"))

    @property
    def token_path(self) -> Path:
        return Path(
            os.environ.get("FOXLINK_BUSINESS_API_TOKEN_FILE", self.data_dir / "business-api-token")
        )
