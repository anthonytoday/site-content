# Gumroad marketplace cover art

Designed cover and thumbnail images for the Gumroad catalogue (anthonytoday.gumroad.com). One subfolder per listing, named after the Gumroad permalink. These are designed marketing assets; raw template screenshots for the listings live in the Notion template galleries (see assets/template-images-manifest.json).

## Convention

- `assets/gumroad/<permalink>/`: one folder per listing
- `thumbnail.png`: the designed square thumbnail shown in the shop profile and Gumroad Discover
- `cover.png`: the designed main cover, first image in the listing gallery
- Filenames stay stable; replace the file to update the art, git history keeps every version

## Pending uploads (2026-08-17)

| File to upload | Folder | Gumroad listing | Role |
|---|---|---|---|
| Trading Journal - Pro.png | `assets/gumroad/trading-journal/` | Trading Journal Like a Pro, Get Profitable ($39) | thumbnail |
| Financial Bundle.png | `assets/gumroad/finance-cert-bundle-3x-premium/` | Finance Cert Bundle (3x) ($97) | cover (main) |

Upload via github.com: open this folder, Add file → Upload files, drop the PNG, rename it per the convention (thumbnail.png or cover.png), commit to main.

Once committed, the public raw URL (raw.githubusercontent.com/anthonytoday/site-content/main/…) can be attached to the Gumroad listing through the API.