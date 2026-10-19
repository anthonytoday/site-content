# Security Check path tests (headless Chrome)

Walks every path of /security-check/ to a real submit and checks the Worker-rendered pages.

    npm install
    CHROME=/usr/bin/google-chrome BASE=https://security-check.security-check-preview.pages.dev \
      EMAIL=test+sc@anthonytoday.com FIX_URL='<signed /f/ link>' node paths.test.mjs

- EMAIL must not be on the Worker allowlist while the real-client lock is on, so no email is sent (result is "held").
- FIX_URL is optional; when set, the Fix List page gets the same layout checks as /r/.
- Layout checks at 1280, 390 and 360 px: no horizontal scroll, no empty headings, no unfilled {{ }}.
