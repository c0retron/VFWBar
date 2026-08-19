# VFW Bar POS System — Design Notes

Captured from the "VFW Bar POS System" project in Claude Design (`claude.ai/design/p/f9ef9a92-c606-4cfa-aa8c-d53124a69ee4`) on 2026-08-19, via Designer's official Claude Code handoff. Source of truth:

- [`vfw-bar-pos-system/project/VFW Bar POS.dc.html`](vfw-bar-pos-system/project/VFW%20Bar%20POS.dc.html) — the actual prototype (HTML/CSS/JS, byte-for-byte as built). **Read this in full before implementing anything** — see `vfw-bar-pos-system/README.md` for handoff instructions from Designer itself.
- [`docs/design-chat-transcript.txt`](docs/design-chat-transcript.txt) — the full conversation the prototype was built from. This file captures that reasoning in plain English, organized by topic.

## The original ask

Single-location VFW bar, one user (the bartender), tablet-optimized. Replaces: a pen-and-paper tab list, an old Sharp register, and a paper log binder for nightly close-out counts. Explicitly **not** wanted: inventory tracking (too much complexity for the shelf space they have) — instead, a "what sold in the last 10 days" report to eyeball against the shelf when shopping. A card reader is already owned and out of scope, though a recommendation was requested (see below). An APK was the stated preference for latency, confirmed appropriate (see APK vs. web below).

## Scope decisions (from the requirements rounds)

- **Screens**: all four requested screens, plus Admin — Tabs, The Book, Sales, Close-out, Admin.
- **Orientation**: landscape (tablet).
- **Tab features**: comps/on-the-house, and buy-a-round for others (see the star system below).
- **Tax**: none.
- **Close-out counting**: bills only (no coin counting).
- **Backend**: Google Sheets sync.
- **Sales insights**: best sellers, day-of-week trends, busiest hours, month vs. last month.
- **Regulars seeded for demo**: Cory, Paul, Charlie, Mac, Tom, Jim, Liz, Conrad, Fulkerson.
- **Walk-in tabs**: supported alongside regulars.
- **Comp accounting**: tracked at full value (i.e., comps show as revenue given away, not just omitted).
- **Day boundary**: close-out is what ends the day.
- **Open tabs at close-out**: close-out is blocked until all tabs are settled.

## Visual system

"Industry" design system (`vfw-bar-pos-system/project/_ds/industry-*/readme.md`): steel-blue on light ground, blueprint/wireframe styling — square corners, hairline borders, crosshair corner marks on cards and the primary button. Barlow Condensed headings over Barlow body text.

## The five screens

Local-first — everything happens instantly on the tablet; a background copy of each day's sales, book entries, and close-out sheet syncs to Google Sheets. Data persists on the tablet; Admin has a "Reset demo data" option. Regulars are sorted most-frequent-first when starting a tab; adding a drink to an existing tab suggests that person's regular purchases.

### The Book (running tabs / house credit)

Added because customers sometimes "put it on the books" (forgot a wallet, want a running tab for a week/month) or get credited for VFW favors/volunteer work.

- **Settle actions**: pay down in cash/card, credit for VFW favors, settle part of a balance, or charge new drinks directly to the book.
- **Close-out treatment**: its own line in the close-out sheet, not folded into card/cash totals.
- **Limits**: none.
- **History**: full ledger per person, not just a running total.

### Buy-a-round / gold star system

Went through two rounds of refinement after the initial build — worth stating plainly since the logic is nuanced:

1. **Starting a round**: "Buy a round" opens a dialog listing every open tab (including the buyer's own), each defaulting to 1 person with +/− to adjust. Confirming hands out one gold star per person, per tab.
2. **Stars are visible** on both the tab cards (main Tabs screen) and inside tab detail.
3. **Claiming a star**: the *next* drink ordered on a starred tab automatically claims one star. It rings as its own separate line item — even if that drink was already on the tab — labeled `★ from <buyer>`. The charge lands on the **buyer's** tab as `<drink> · for <recipient>`, at $0 on the recipient's side.
4. **Applying a star to an existing drink**: a `★ Apply` button lets a star cover a drink already on the tab instead of waiting for a new order. If the existing line has quantity > 1, it splits off one unit to apply the star to.
5. **Undo**: deleting either side of a claimed round (the $0 line or the buyer's charge line) undoes both and restores the star.
6. **Transfers**: if a tab line has quantity > 1, transferring it now asks how many units to transfer (previously moved the whole line).
7. **Unclaimed stars at close-out**: originally these went "on the house." Changed to: closing a buyer's tab with unclaimed stars charges each star at the price of that buyer's *last drink ordered* (shown in the close dialog as e.g. "3 items + 2 ★ round", itemized with which drink the price came from). The star still stays on the recipient's tab for later use — when they do claim it, the drink rings at $0 and any price difference (if their eventual drink costs more) is absorbed on the house. Deleting a claimed prepaid drink puts the star back.

### Tips (credit card)

A tip amount can be tracked per credit-card charge, added on top of the charged total. The running tip total is surfaced at final close-out as the amount the bartender pulls from the till as tips. **This was the last feature requested before the Designer session hit a usage-credit cap** — it does appear implemented in the prototype (`tip`/`tips`/`tipBtns`/`tipCustom` all present), but wasn't reviewed/approved in chat the way the earlier features were. Test this one carefully.

### Close-out

Bill count → deposit plan that keeps the till at a $200 target (adjustable — see the `tillTarget` setting). Counts bills only, no coins. Blocked until all tabs are settled. The book has its own line (see above).

### Sales

Charts and reports: best sellers, day-of-week trends, busiest hours, month vs. last month, filterable by customer. Includes a "last 10 days sold" report — the intended substitute for real inventory tracking (see "The original ask" above for why).

## Open items carried into the handoff

- **Card reader**: keep the existing separate reader for now. If it's ever swapped: Square's free plan (2.6% + 15¢ per in-person tap, ~$59 reader, no monthly fee) was the reference point mentioned for VFW-scale volume.
- **APK vs. web**: confirmed APK is the right instinct, but noted that latency actually comes from the backend, not the install format — the local-first design already avoids that. Both a wrapped Android app and an installed PWA were floated as valid targets; either gets a home-screen icon and offline use. **This is the actual build target for the Claude Code handoff.**
