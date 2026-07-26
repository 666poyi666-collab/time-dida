from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ControlCommand(BaseModel):
    requestId: str = Field(min_length=8)
    commandId: str = Field(min_length=8)
    expectedRevision: int = Field(ge=0)
    expectedState: Literal["idle", "running", "paused", "finished"]
    expiresAt: int = Field(gt=0)
