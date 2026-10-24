"""Cache backend that never fails a request."""

import logging

from django.core.cache.backends.filebased import FileBasedCache

logger = logging.getLogger(__name__)


class ResilientFileBasedCache(FileBasedCache):
    """FileBasedCache that treats I/O errors as misses.

    Concurrent writers can lose the rename race (PermissionError on Windows), and full or
    read-only disks raise OSError; neither should turn a lookup into a 500.
    """

    def get(self, key, default=None, version=None):
        try:
            return super().get(key, default, version)
        except OSError as exc:
            logger.warning("Cache read failed for %s: %s", key, exc)
            return default

    def set(self, key, value, timeout=None, version=None):
        try:
            super().set(key, value, timeout, version)
        except OSError as exc:
            logger.warning("Cache write failed for %s: %s", key, exc)

    def add(self, key, value, timeout=None, version=None):
        try:
            return super().add(key, value, timeout, version)
        except OSError as exc:
            logger.warning("Cache add failed for %s: %s", key, exc)
            return False
