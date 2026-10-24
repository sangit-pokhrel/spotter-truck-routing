"""Docker HEALTHCHECK probe: exit 0 when /api/health/ answers."""

import os
import sys
import urllib.request

try:
    urllib.request.urlopen(f"http://127.0.0.1:{os.environ.get('PORT', '8000')}/api/health/", timeout=4)
except Exception as exc:
    print(f"unhealthy: {exc}", file=sys.stderr)
    sys.exit(1)
