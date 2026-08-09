# assets/ — where images live and what they are called

One rule: **an image lives in the folder of the thing it belongs to.** If you cannot say which
template or page an image serves, it does not belong in `assets/`.

```
assets/
  templates/<template-id>/      one folder per shop listing, id matches _data/templates.yml
    cover.webp                    the card thumbnail and the first gallery slide
    desktop/01-name.webp          extra desktop screenshots, numbered in display order
    mobile/01-name.jpg            phone screenshots, numbered in display order
  brand/                        profile photo, favicon, certification badges
  logos/                        third-party logos used on /tools/ and the home page
  guides/how-it-works/          screenshots used by /templates/how-it-works/
  images/                       frozen, see the warning below
```

## Naming

| Slot | Pattern | Example |
| :--- | :--- | :--- |
| Cover | `cover.webp` | `assets/templates/dream-travel-planner/cover.webp` |
| Desktop | `desktop/NN.webp` or `desktop/NN-short-name.webp` | `desktop/03-home-page.webp` |
| Mobile | `mobile/NN.jpg` or `mobile/NN-short-name.jpg` | `mobile/02-finances.jpg` |

Numbering starts at `01` and matches the order the images appear in `_data/templates.yml`.
The short name is optional; add it when it helps a human find the right screenshot, and leave
it off when the shot is generic.

## Formats and sizes

- **Desktop: WebP, max 1600px wide, quality 82.** Aim for under 150 KB.
- **Mobile: JPEG, 600 x 1200, quality 84, progressive.** Aim for under 250 KB.
- Two covers are still PNG (`cpa-exam-prep`, `ultimate-content-manager`). **Do not convert or
  rename them without updating the matching Stripe product in the same session**, because live
  Stripe products point at those exact URLs and Checkout would show a broken image.

## Never hotlink

Every image must be served from this repo. Do not point `_data/templates.yml` at
`s3-us-west-2.amazonaws.com/public.notion-static.com/...`. Those URLs are Notion's, they carry
an upload timestamp, and they change without warning. Download the file into the template's
folder instead.

## assets/images/ is frozen

It holds exactly one file, `notion-business-offer.jpg`. Resend broadcasts that have **already
been sent** reference that absolute URL, and moving it would break the image in mail sitting in
subscribers' inboxes. Leave it. Put anything new in `brand/` or a template folder.

## Adding a listing

1. `mkdir -p assets/templates/<id>/{desktop,mobile}`
2. Drop in `cover.webp`, then the numbered desktop and mobile shots.
3. Add the `cover`, `gallery` and `mobile` paths to `_data/templates.yml`.
4. Create `template-<id>.html` and `fr/template-<id>.html`, each pointing at the other through
   `alt_url`. The bilingual rule in `BILINGUAL-RUNBOOK.md` is not optional.
