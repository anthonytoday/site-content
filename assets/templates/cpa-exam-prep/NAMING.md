# Screenshot drop-in: CPA Exam Prep

Drop files here with these exact names and the gallery wires itself. The naming mirrors
`assets/templates/ultimate-business-dashboard/`, which is the working reference.

## Desktop (up to 5, `.webp`, roughly 1600x1000, 16:10)

| Filename | What to capture |
| --- | --- |
| `cover.png` | **Already here.** The hero image |
| `01-progress-dashboard.webp` | Percentage complete per section, all six sections visible |
| `02-flashcards.webp` | The flashcard database with the spaced-repetition scheduling |
| `03-practice-questions.webp` | The question bank with score history per topic |
| `04-weak-areas.webp` | The weak-area view that surfaces repeat mistakes |
| `05-study-calendar.webp` | The calendar working backwards from an exam date |

## Mobile (up to 3 shown in the phone strip, `.jpg`, portrait)

| Filename | What to capture |
| --- | --- |
| `m00-dashboard.jpg` | The dashboard on a phone |
| `m01-flashcards.jpg` | Flashcards on a phone |
| `m02-calendar.jpg` | The study calendar on a phone |

## How to capture

1. Open the template in your own Notion workspace.
2. Full-window screenshot on desktop, then a real phone screenshot for the mobile set.
3. Crop the desktop shots to 16:10. The gallery uses `aspect-ratio:16/10` and will letterbox anything else.
4. Convert desktop shots to `.webp` to keep them under ~120KB. Keep mobile as `.jpg`.
5. Tell me they are in and I will add the `gallery:` and `mobile:` arrays to `_data/templates.yml`.

## Why I cannot fetch these myself

The Notion marketplace gallery is client-side rendered, so the image elements come back empty
(`![](<>)`) in the page source. The only server-rendered image is the single Open Graph card at
`https://www.notion.com/en-us/front-api/og-image/templates/cpa-exam-study-plan`, which is a
social-share card, not a product screenshot. My tooling also cannot download binary files.
The screenshots have to come from you, from the live template.
