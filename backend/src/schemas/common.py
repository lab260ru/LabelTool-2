"""Base pydantic schemas shared by all routers.

Feature-specific schemas live in schemas/<f>.py.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ErrorResponse(BaseModel):
    """Standard FastAPI error body: {"detail": "..."}"""

    detail: str


class OkResponse(BaseModel):
    ok: bool = True


class PageParams(BaseModel):
    """Pagination parameters (query)."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=500)


class Page(BaseModel, Generic[T]):
    """Page of results for lists (100k+ fragments — pagination only)."""

    items: list[T]
    total: int
    page: int
    page_size: int
