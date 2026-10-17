#!/usr/bin/env python3
"""Syntax-check inline scripts in built HTML with `node --check`.

Walks a Jekyll `_site` directory, extracts every inline `<script>` whose
type is JavaScript (or omitted), and fails if Node cannot parse it.
JSON-LD, JSON, and other non-script types are skipped. External scripts
(a src attribute and an empty body) are skipped.

Usage: python3 .github/scripts/check-inline-js.py [site_dir]
"""
import os
import re
import subprocess
import sys
import tempfile

SITE = sys.argv[1] if len(sys.argv) > 1 else "_site"

SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.I | re.S)
ATTR_RE = re.compile(
    r"""([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))""",
    re.I,
)
JS_TYPES = {
    "",
    "text/javascript",
    "application/javascript",
    "text/ecmascript",
    "application/ecmascript",
    "module",
}


def attrs_of(raw):
    found = {}
    for match in ATTR_RE.finditer(raw):
        value = next(group for group in match.groups()[1:] if group is not None)
        found[match.group(1).lower()] = value
    return found


def walk_html(root):
    for dirpath, _, files in os.walk(root):
        for name in files:
            if name.endswith(".html"):
                yield os.path.join(dirpath, name)


def kind_of(attrs):
    """'js', 'module', or None when the block is not JavaScript."""
    if "type" not in attrs:
        return "js"
    typ = attrs["type"].strip().lower()
    if typ == "module":
        return "module"
    if typ in JS_TYPES:
        return "js"
    return None


def main():
    if not os.path.isdir(SITE):
        print("inline-js: site directory not found: %s" % SITE, file=sys.stderr)
        return 1

    failures = []
    checked = 0
    pages = 0
    for path in sorted(walk_html(SITE)):
        pages += 1
        text = open(path, encoding="utf-8", errors="replace").read()
        rel = os.path.relpath(path, SITE)
        for match in SCRIPT_RE.finditer(text):
            attrs = attrs_of(match.group(1))
            body = match.group(2)
            kind = kind_of(attrs)
            if kind is None:
                continue
            if "src" in attrs and not body.strip():
                continue
            if not body.strip():
                continue
            checked += 1
            suffix = ".mjs" if kind == "module" else ".js"
            fd, tmp = tempfile.mkstemp(suffix=suffix)
            try:
                os.write(fd, body.encode("utf-8"))
                os.close(fd)
                fd = None
                result = subprocess.run(
                    ["node", "--check", tmp],
                    capture_output=True,
                    text=True,
                )
            finally:
                if fd is not None:
                    os.close(fd)
                os.unlink(tmp)
            if result.returncode != 0:
                start = text.count("\n", 0, match.start(2)) + 1
                detail = (result.stderr or result.stdout or "node --check failed").strip()
                failures.append((rel, start, detail))

    print("inline-js: checked %d inline scripts across %d html files" % (checked, pages))
    if failures:
        print("\nINLINE SCRIPT SYNTAX ERRORS:")
        for rel, start, detail in failures:
            print(" - %s (script starts at line %d)" % (rel, start))
            for line in detail.splitlines():
                print("   " + line)
        return 1
    print("inline-js: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
