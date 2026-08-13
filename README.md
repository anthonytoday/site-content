# site-content

Source for **www.anthonytoday.com**, published by **GitHub Pages** (Jekyll) from `main`.
Every push rebuilds the live site in one to three minutes.

## Layout

| Path | What it holds |
| --- | --- |
| `_config.yml` | Site title, canonical URL, analytics token, feature flags |
| `_layouts/default.html` | The `<head>`, header and navigation. **Edit the nav here once and every page updates.** |
| `_includes/` | Shared Liquid partials. See "Shared includes" below |
| `_data/` | The catalogues. `templates.yml`, `decks.yml`, `image_dims.yml`, `cover_srcset.yml` |
| `_css/` | CSS sources. The built bundles live in `assets/css/` and are content-hashed |
| `templates/` | The Notion template shop: hub, how-it-works, and one page per template |
| `flashcards/` | The Anki deck shop: hub, how-it-works, instructions, and one page per deck |
| `shop/` | Shared shop pages, currently the help page |
| `services/`, `pages/` | Marketing and service pages |
| `fr/` | French pages |
| `redirects/` | Redirect stubs, all `noindex` |
| `assets/` | Images, CSS bundles, JS. See "Who owns what" below |
| `home.html`, `404.html` | Homepage and not-found page |
| `robots.txt`, `sitemap.xml`, `llms.txt`, `CNAME` | Site plumbing. Do not delete `CNAME` |

Each page carries front matter with at least `title`, `description` and `permalink`.
Pages with `noindex: true` and `sitemap: false` are hidden: no robots, no sitemap entry.

## The two shops

Both shops run on **one implementation**. The includes are parameterised, never forked.

```liquid
{% include shop-grid.html catalogue=site.data.decks %}
{% include pd-buybox.html catalogue=site.data.decks id="cissp-flashcards" %}
```

Called bare, they default to `site.data.templates` and `page.template_id`, so every
templates page behaves exactly as it always did.

| Include | Job |
| --- | --- |
| `shop-grid.html` | The card grid, filters and product-type badge |
| `pd-buybox.html` | Price, buy button and upgrade band. Resolves Stripe, then Etsy, then Notion Marketplace |
| `shop-gallery.html` | Gallery, phone strip, lightbox. Takes `noun` so a deck page does not say "template" |
| `last-updated.html` | The Last updated cell |
| `shop-footer.html` | Shop footer |

**Adding a product is a data-only change.** Add an entry to `_data/templates.yml` or
`_data/decks.yml` and create the page from an existing one. The hub, counts, filters,
search and badges all follow automatically.

**Switching a deck to native checkout** is one field: paste a payment link into `stripe:`
and the buy button stops pointing at Etsy. No page edit.

## Who owns what under `assets/`

This repo has **two writers**, and the split matters.

| Path | Owner | Rule |
| --- | --- | --- |
| `assets/templates/`, `assets/etsy/` | The image-import Action | Do not hand-edit. Add a `{path, url}` pair to `assets/template-images-manifest.json` and the Action downloads and commits it |
| `assets/template-images-manifest.json` | The image-import Action | Append only, never rewrite |
| `.github/` | The Action | Leave alone unless changing the pipeline itself |
| everything else | People | Normal edits |

`.github/import-result.txt` records the last run, for example
`downloaded=270 already_present=132 failed=0`.

After images land, point the catalogue at them:

```
python3 wire-deck-images.py <repo> --write
```

It reads what is actually on disk, sorts photos by pixel shape (portrait becomes the
phone strip, landscape the gallery) and appends real dimensions to `image_dims.yml`,
so nothing shifts while a page loads.

## Feature flags in `_config.yml`

| Flag | Effect |
| --- | --- |
| `shop_nav` | `false` hides the Shop menu. `true` reveals Notion Templates, Anki Flashcards and Help in the header |
| `cf_analytics_token` | Empty means no analytics beacon is emitted at all |

## Before you push

The site has no test suite, so changes are verified by rendering. Confirm that:

1. every catalogue id has a page and every page has a catalogue entry
2. permalinks are unique across the whole site
3. product pages still match the reference page structurally
4. pages that should be hidden still carry `noindex` and `sitemap: false`
5. no page that already existed renders differently unless you meant it to

House style: **no em dashes anywhere**, including commit messages. English only in
the flashcards shop. Never invent a card count, price, rating or review: unknown
values are the literal string `TBC`.
