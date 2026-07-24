# site-content

Source for **www.anthonytoday.com**, published directly by **GitHub Pages** (Jekyll) from `main`.

Previously these files were HTML fragments loaded into MailerLite landing pages at runtime. That loader is gone. Each page is now a real page.

## How it works

- `_config.yml` — site-wide title, description, canonical URL.
- `_layouts/default.html` — the `<head>`, site header and navigation. **Edit the nav here once and every page updates.**
- `*.html` — one file per page. Each starts with front matter setting `title`, `description` and `permalink`.
- `CNAME` — custom domain. Do not delete.
- `assets/` — images, served from this repo (no CDN).

## Page map

| File | URL |
|---|---|
| `home.html` | `/` |
| `notion.html` | `/notion/` |
| `cyber.html` | `/cyber/` |
| `cyber-grc.html` | `/cyber-grc/` |
| `fractional-ciso.html` | `/fractional-ciso/` |
| `tools.html` | `/tools/` |
| `use-case.html` | `/use-case/` |
| `guide.html` | `/guide/` |
| `contact.html` | `/contact/` |

## Adding a page

Create `newpage.html` with front matter, then add it to the nav list in `_layouts/default.html`:

```
---
layout: default
title: "Page title for search results"
description: "Meta description, roughly 150 characters."
permalink: /newpage/
---
```

Push to `main`. GitHub Pages rebuilds in about a minute.

## Outstanding

- `assets/images/placeholder-01..04.png` are stand-ins for images that used to load from MailerLite's CDN. Replace with the real files, same filenames.
- 13 images still hotlink `cdn.prod.website-files.com`. Re-host them under `assets/`.
- Each page carries its own duplicated `<style>` block and its own copy of the footer. Consolidate into the layout when convenient.
