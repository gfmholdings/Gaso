#!/usr/bin/env python3
"""Key-safe live diagnostic using the browser app's validated core logic.

Usage: python3 test-prices.py [FROM TO]
Requires Node.js 22+. Reads PLACES_API_KEY from the environment or a local
.env file. This makes billable Google requests; it is not an offline test.
"""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def load_key():
    key = os.environ.get('PLACES_API_KEY', '').strip()
    if key:
        return key
    env_file = ROOT / '.env'
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            name, separator, value = line.strip().partition('=')
            if separator and name == 'PLACES_API_KEY':
                return value.strip().strip('\"\'')
    return ''


def main():
    if '--help' in sys.argv[1:]:
        print(__doc__)
        return 0
    key = load_key()
    if not key or key == 'paste-your-key-here':
        print('Set PLACES_API_KEY in the environment or a local .env file. Never commit the real key.', file=sys.stderr)
        return 1
    env = dict(os.environ, PLACES_API_KEY=key)
    try:
        return subprocess.run(['node', str(ROOT / 'tools/live-prices.js'), *sys.argv[1:]], env=env, check=False).returncode
    except FileNotFoundError:
        print('Node.js 22+ is required for this diagnostic.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
