# Tribal Vend — Design Standard

Android-only target. Built to Google Material 3 (the design system Android
itself uses). Every number below comes from Google's official token files in
`@material/web` 2.5.0 (`tokens/versions/v0_192`) or the M3 guidelines — not
estimates. The interaction audit checks the app against this list.

## Color
Generated with Google's `@material/material-color-utilities` from the brand:
- Accent roles from crown yellow `#fdfd00` (SchemeFidelity)
- Surfaces from crown charcoal `#282828` (SchemeNeutral)

Rules:
- Yellow is a **fill** (selected pill, primary buttons), always with dark ink on
  it. Yellow is never text or a thin line on a light surface.
- Readable accent text on light = `--md-primary` `#626200`.
- Every text/background pair must pass WCAG AA (4.5:1 body, 3:1 large/icons).
- Light and dark schemes both fully defined; toggle flips all of it.

## Type (M3 type scale, system Roboto on Android)
| Role | Size / line | Weight |
|---|---|---|
| Headline small | 24 / 32 | 400 |
| Title large (app bar) | 22 / 28 | 400 |
| Title medium | 16 / 24 | 500 |
| Title small | 14 / 20 | 500 |
| Body large | 16 / 24 | 400 |
| Body medium | 14 / 20 | 400 |
| Body small | 12 / 16 | 400 |
| Label large (buttons) | 14 / 20 | 500 |
| Label medium (nav) | 12 / 16 | 500 |
Numbers use tabular figures.

## Shape (corner radius)
none 0 · extra-small 4 · small 8 · medium 12 · large 16 · extra-large 28 · full.
Cards = medium 12. Bottom sheet = extra-large top 28. Buttons/chips/pill = full or small per component.

## Components
- **Top app bar**: 64px, surface color, title large. Gains tonal color on scroll.
- **Navigation bar**: 80px tall, surface container, 24px icons, label medium,
  selected = 64×32 full-round pill in secondary container.
- **Buttons**: 40px tall visual, full-round. Filled (primary action), tonal,
  outlined, text. Min 48px touch target.
- **Cards**: filled or outlined, 12px radius, 16px padding.
- **Lists**: 16px side padding; one-line 56px, two-line 72px rows.
- **Bottom sheet**: 28px top corners, 32×4 drag handle, scrim behind.
- **Snackbar**: bottom, above nav, one at a time, one optional action (e.g.
  Undo), 4px radius, inverse surface. Never the only feedback: the triggering
  control also changes state.
- **Chips**: 32px, 8px radius.
- **Extended FAB**: 56px, 16px radius.

## Layout
- Compact window margins 16px; spacing on a 4px grid (8/12/16/24).
- Touch targets ≥ 48×48dp, ≥ 8dp apart.
- Safe areas respected (status bar, gesture bar).

## Motion
- Standard easing `cubic-bezier(0.2, 0, 0, 1)`; enter `cubic-bezier(0.05, 0.7, 0.1, 1)`;
  exit `cubic-bezier(0.3, 0, 0.8, 0.15)`.
- Short 100–200ms for small state changes; medium 250–400ms for sheets/pages.
- `prefers-reduced-motion` removes movement.
- State layers: pressed 12%, focus 12%, hover 8%.

## Behavior (modern Android expectations)
- **System back gesture** closes the open sheet/dialog instead of exiting the app.
- **Pull to refresh** on data screens; browser's own pull-to-refresh disabled
  (`overscroll-behavior-y: contain`) so it doesn't double up.
- **No page jumps**: redraws keep scroll position and open sections; keyboard
  uses `interactive-widget=resizes-content`.
- **Loading**: skeletons in the shape of the content, not "Loading…" text.
- **Feedback**: every tap shows a pressed state; saves confirm inline + snackbar;
  failures are visible, never silent.
- **Numbers**: `inputmode="numeric"`, tap selects existing value.
- Interactive elements not text-selectable; no blue tap flash.
- Dark mode from system by default, manual toggle overrides.

Sources: @material/web 2.5.0 tokens; m3.material.io (navigation bar, snackbar,
accessibility/structure); web.dev/learn/pwa/app-design; Chrome viewport resize
behavior (developer.chrome.com/blog/viewport-resize-behavior).
