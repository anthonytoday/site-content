#!/usr/bin/env python3
"""Write security/csp-header.txt from the header: key in _data/csp.yml.

Single source of truth: edit _data/csp.yml (header: and script_hashes:), then run
  python3 .github/scripts/generate-csp-header.py
and commit the updated security/csp-header.txt. Grok pastes that file into
Cloudflare as the enforcing Content-Security-Policy header.
"""
import os
import re
import sys


def main(argv):
    # argv is sys.argv[1:] (positional args only)
    yml = argv[0] if len(argv) > 0 else os.path.join("_data", "csp.yml")
    out = argv[1] if len(argv) > 1 else os.path.join("security", "csp-header.txt")
    text = open(yml, encoding="utf-8").read()
    m = re.search(r'^header:\s*"([^"]+)"\s*$', text, re.M)
    if not m:
        print("generate-csp-header: ERROR: no header: \"...\" key in %s" % yml, file=sys.stderr)
        return 1
    value = m.group(1).replace("&#39;", "'")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(value + "\n")
    print("generate-csp-header: wrote %s (%d bytes)" % (out, len(value)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
