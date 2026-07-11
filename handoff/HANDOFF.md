# Chief — design handoff (v1)

Mobile-first PWA, one user, dark primary. Spec canvas: `Chief Design Spec.dc.html`
(1a foundations · 1b components · 1c screens 390×844 · 1d desktop Home · 2a light-mode Home · 2b all-clear Home).

Bundle contents: this file (intent notes) + `Chief Design Spec.dc.html` (all visuals) + `ios-frame.jsx` / `support.js` (preview scaffolding only — not product code).

## Design intent

- **Calm precision instrument.** Warm charcoal + desaturated teal. Chief's intelligence reads through content, never decoration: no gradients-as-AI or sparkles. A small red dot is reserved for actionable Chief notifications.
- **Three voices, three typefaces.**
  - Newsreader (serif, often italic) = Chief speaking: narrative, bar status, chat replies. Never used for user-owned content.
  - Instrument Sans = everything the user owns or acts on.
  - IBM Plex Mono = machine facts only: priorities, dates, counts, action labels (`CREATE TASK`).
- **Signature element = the floating Chief launcher.** The circular `C` mirrors the menu control at top-right and stays in place on every signed-in screen.

## Color tokens

Dark (primary): bg `#131513` · surface `#1A1D1B` · raised `#222724` · ink `#ECEFEA` · ink-2 `#A6AEA7` · ink-3 `#6F7871` · hairline `rgba(236,240,236,.08)` · teal `#8FC1B7` · teal-fill `#33635A` (button text `#E3F0EC`) · teal-dim `rgba(84,140,128,.14–.22)` · copper `#D29962` (fills at 9–14% alpha, borders at 22–42%) · ok `#8CBE93` · danger `#CE8577`.

Light: bg `#F3F2ED` · surface `#FCFCFA` · ink `#1C201D` · ink-2 `#565E58` · teal `#2C5F56` · copper `#9A6432` · ok `#77A683` · danger `#B4584A`. Same hue positions, paper-warm — never pure white page bg.

**Semantic rule: teal = Chief + reversible. Copper = irreversible / attention-aging (stale state, day-6 waits). Green = confirmation only. Red = destructive text or a notification dot.**

## Type scale
narrative 21/30 serif 500 (22px on phone Home, 27 desktop) · title 17/22 sans 600 · body 16/24 sans 400 · label 14/18 sans 500 · meta 12/16 mono · micro 11/14 mono caps ls .1em.

## Spacing & radii
4px base. Screen gutter 16, card padding 16–20, section gap 24–28. Radii: 6 chip · 12 control · 16 card · 24 sheet top · pill. Controls: primary 48px, floating controls/min tap 44px. Focus: 2px teal outline, 2px offset, never removed.

## Chief launcher (global, top-right)
- **Idle:** 44px circular teal `C`, matching the hamburger's placement and floating surface.
- **Pending:** a static 10px red dot appears at the launcher's top-right when proposals or proactive events await review. The accessible label includes the notification count.
- **Opened:** full-height sheet over the page with context line `LOOKING AT: <thing on screen>` + close. Page context is preserved.
- Desktop: the same persistent launcher opens the constrained conversation sheet.

## Proposal card
Header: mono action label (teal) + tier note. Body: plain-language exact effect, bold the object. Footer: actions.

- **Standard (reversible):** teal-tinted surface `#1C211E`, teal border 22%, Approve (teal-fill, flex 1.6) + Dismiss (ghost). One tap.
  - executing: buttons → spinner + "Creating task…" on teal-dim.
  - done: collapses to receipt row (green check + "Task created — X" + persistent **Undo**).
  - dismissed: dashed hairline, ink-3 text, "Restore". Copy: "Chief won't re-suggest today."
- **Irreversible (email/money/external):** copper frame + 4px outer copper wash, banner `◆ SEND EMAIL · IRREVERSIBLE`, an "exact payload" preview block (tap to expand — user can always read the exact email), **slide-to-send** (56px pill track, 46px thumb) — deliberate physics, no accidental tap. Dismiss is plain text below. Never batched, never "approve all".
- **Batch:** standard-tier only. Header row `N PROPOSALS · ALL REVERSIBLE` + Approve all; each row keeps individual ✓ / ✕ (38px targets in-list; fine inside a card).

## Screens
- **Home:** date line → Chief narrative (serif, 1–2 sentences, key phrase in teal) → TOP 3 ranked task rows → WAITING ON list (status dot: green=moved, gray=quiet, copper=aging) → inline proposal cards. All-clear state: narrative becomes the reward ("Nothing needs you until 2 PM.").
- **Inbox:** one email at a time. `4 MORE` pill top-right (informational; actions live in thumb zone). Chief's one-line read of the email sits at the card bottom in serif. Actions: Ask Chief (primary 52px) / Archive / Reply.
- **Project:** name + ACTIVE chip + goal → CURRENT STATE prose block (editable, with copper stale strip "Last verified 12 days ago · Ask Chief to refresh →") → NEXT ACTION (teal-bordered, `linked task`) → WAITING ON / BLOCKERS pair → task rows with ⋮⋮ reorder handles.
- **Chief sheet:** context header, user bubbles right (teal-dim), Chief replies as serif text with small monogram (no bubble), proposal cards inline full-width, composer 50px docked above keyboard/home indicator.

## Nav
The 44px floating hamburger at top-left opens the navigation drawer. The persistent 44px Chief launcher mirrors it at top-right.

## PWA notes
standalone display; safe-area insets via `env()`; floating controls clear the status area and content clears the home indicator; respect `prefers-reduced-motion`.
