---
title: Documentation media
description: Reproduce screenshots and walkthrough clips from the seeded application.
---

# Documentation media

Capture documentation media from the seeded Compose application at
`http://localhost:8080`. Sign in with the development account documented in the
repository and select the Acme Project.

## Capture standard

- Desktop: 1440 × 900, light theme, browser chrome excluded.
- Mobile: 390 × 844 for navigation and responsive examples.
- Use populated seeded state and wait for loading transitions to finish.
- Keep credential values, tokens, and Secret inputs outside the frame.
- Store page screenshots in `docs/screenshots/app/` as optimized PNG or WebP.
- Store silent animated walkthrough clips in `docs/public/demos/`.
- Use lowercase, hyphenated filenames that match the documented route.

## Screenshot checklist

`docs/menu-docs.json` records the application route, documentation page, and
expected screenshot for every persistent menu entry. Update the screenshot when
labels, actions, layout, or the representative seeded state changes.

## Walkthrough clips

Keep each clip focused on one workflow and pair it with numbered Markdown steps.
Use the same seeded names and input shown in the written guide. Run
`pnpm docs:media` after refreshing screenshots and verify animation in the
production VitePress build.
