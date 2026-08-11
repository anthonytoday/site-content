#!/usr/bin/env python3
"""Download every image listed in assets/template-images-manifest.json.

Lives in a file rather than a heredoc inside the workflow YAML: indentation
inside a block scalar is easy to get wrong and impossible to test locally,
and this can be run directly.

Each URL is attempted independently so one failure cannot discard the rest,
and a summary is written to .github/import-result.txt which the workflow
commits, so the outcome is visible in the repo without opening the run log.
"""
import json, os, sys, urllib.request

MANIFEST = 'assets/template-images-manifest.json'
RESULT = '.github/import-result.txt'
UA = 'Mozilla/5.0 (compatible; anthonytoday-site-import/1.0)'

def main():
    items = json.load(open(MANIFEST))
    done, skipped, failed, lines = 0, 0, 0, []

    for it in items:
        path, url = it['path'], it['url']

        if os.path.exists(path) and os.path.getsize(path) > 0:
            skipped += 1
            continue

        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(url, headers={
            'User-Agent': UA,
            'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*',
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) < 100:
                raise ValueError('response too small: %d bytes' % len(data))
            with open(path, 'wb') as f:
                f.write(data)
            done += 1
            print('ok      %s (%d KB)' % (path, len(data) // 1024))
        except Exception as e:
            failed += 1
            lines.append('FAILED %s <- %s : %s' % (path, url, e))
            print(lines[-1])
            # never leave a half-written file behind to be skipped next run
            if os.path.exists(path) and os.path.getsize(path) == 0:
                os.remove(path)

    summary = 'downloaded=%d already_present=%d failed=%d' % (done, skipped, failed)
    print('\n' + summary)
    os.makedirs('.github', exist_ok=True)
    with open(RESULT, 'w') as f:
        f.write(summary + '\n' + '\n'.join(lines) + ('\n' if lines else ''))
    # exit code is decided by the workflow after committing, so partial
    # progress is never thrown away by a non-zero exit here
    return 0

if __name__ == '__main__':
    sys.exit(main())
