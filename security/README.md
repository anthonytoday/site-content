# CSP header artefact (0061)

`csp-header.txt` is the exact `Content-Security-Policy` value Grok pastes into
Cloudflare as the enforcing response header. It is generated from the `header:`
key in `_data/csp.yml` by `.github/scripts/generate-csp-header.py`.

This directory is listed in `_config.yml` `exclude`, so Jekyll does not copy it
into `_site` and it is never served on www.anthonytoday.com.
