import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def clear_cache():
    """The file cache outlives a test run; start every test from a clean slate."""
    cache.clear()
    yield
    cache.clear()
