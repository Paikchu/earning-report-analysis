# Daily Review and RSI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a compact RSI-aware position header and a source-backed daily portfolio review that the existing IBKR automation refreshes after a valid snapshot.

**Architecture:** Keep IBKR as the accounting source and Yahoo daily closes as the display-only market source. Calculate 14-day Wilder RSI in the existing quote boundary. Store the latest validated review as a versioned JSON artifact, pass it from the server page into the existing dashboard, and let the daily automation replace it only after snapshot and source checks pass.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vinext, Node test runner, Codex automation, Sites private hosting.

---

### Task 1: RSI contract

**Files:**
- Modify: `tests/yahoo-quotes.test.ts`
- Modify: `lib/yahoo-quotes.ts`
- Modify: `app/positions/[ticker]/PositionDetailContent.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Step 1: Write the failing tests**

- Assert that `calculateRsi` returns Wilder RSI for a known close series, handles flat and one-sided series, and returns `null` with fewer than 15 closes.
- Assert that Yahoo quote parsing attaches `rsi14` from daily closes and that the request uses `range=3mo` with `interval=1d`.
- Assert that the detail price block renders `RSI 14` without feeding the quote into IBKR ledger calculations.

**Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/yahoo-quotes.test.ts`

Expected: FAIL because `calculateRsi`, `rsi14`, and the three-month request do not exist.

**Step 3: Write the minimal implementation**

- Export `calculateRsi(closes, period = 14): number | null` using the initial simple averages followed by Wilder smoothing.
- Read valid closes from `response.indicators.quote[0].close`; preserve current quote behavior when history is incomplete.
- Display the value and one of `超卖`, `中性`, `偏强`, or `超买` in the existing market panel.

**Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/yahoo-quotes.test.ts`

Expected: PASS.

### Task 2: Daily review data gate

**Files:**
- Create: `lib/daily-portfolio-review.ts`
- Create: `data/daily-portfolio-review.json`
- Create: `scripts/validate-daily-portfolio-review.ts`
- Create: `tests/daily-portfolio-review.test.ts`
- Modify: `package.json`

**Step 1: Write the failing tests**

- Define the desired v1 fields: review date, timestamps, tone, headline, summary, material drivers, watch items, and HTTPS sources.
- Assert that the checked-in review matches the current snapshot timestamp and only references current portfolio underlyings.
- Assert rejection for stale snapshot provenance, unknown tickers, empty source lists, and non-HTTPS URLs.

**Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/daily-portfolio-review.test.ts`

Expected: FAIL because the validator and data file do not exist.

**Step 3: Write the minimal implementation**

- Export the v1 TypeScript types and `validateDailyPortfolioReview(review, snapshot)`.
- Keep the validator deterministic and return actionable errors; do not fetch or generate content inside the site.
- Add a CLI that validates the two files and exits nonzero on invalid output.
- Seed the first review from the current snapshot and current cited macro/market sources.

**Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/daily-portfolio-review.test.ts`

Expected: PASS.

### Task 3: Homepage module and compact detail header

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/portfolio-dashboard.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Step 1: Write the failing rendered-output assertions**

- Assert that the homepage contains `每日投资复盘`, the review headline, material drivers, watch items, and source links.
- Assert that the detail header contains the RSI surface.

**Step 2: Run the focused rendered test to verify it fails**

Run: `npm run build && node --test tests/rendered-html.test.mjs`

Expected: FAIL because the review and RSI surfaces are absent.

**Step 3: Write the minimal implementation**

- Import the validated JSON in `app/page.tsx` and pass it as a serializable dashboard prop.
- Add a compact full-width editorial review section between the portfolio header and the existing allocation/ledger grid.
- Reduce detail hero height, ticker size, vertical spacing, and mobile gaps while preserving the current palette and hierarchy.

**Step 4: Run the focused rendered test to verify it passes**

Run: `npm run build && node --test tests/rendered-html.test.mjs`

Expected: PASS.

### Task 4: Daily automation

**Files:**
- Update through Codex automation API: automation `ibkr`

**Step 1: Preserve the hard IBKR gates**

- Keep the current account, cash, open-position, trade retry, no-force-push, exact-HEAD, private deployment, and owner-only checks unchanged.

**Step 2: Extend the post-snapshot workflow**

- Only after the core snapshot passes, review all current underlyings and current macro conditions using primary sources plus a major wire for market context.
- Write at most four material drivers, three watch items, and eight HTTPS sources to `data/daily-portfolio-review.json`.
- Run `scripts/validate-daily-portfolio-review.ts`; on generation failure retain the last good review, publish valid IBKR data, and mark the automation run failed so the existing failure notification fires.
- Allow only the two portfolio JSON files plus the review JSON to change.

**Step 3: Verify the saved automation**

- Read automation `ibkr` back and confirm schedule, notification policy, project ID, and all original safety gates remain present.

### Task 5: Validation and private release

**Files:**
- No additional source files unless a failing check requires a scoped fix.

**Step 1: Run affected tests and static checks**

Run: `node --experimental-strip-types --test tests/yahoo-quotes.test.ts tests/daily-portfolio-review.test.ts`

Run: `npm test`

Run: `npm run lint`

Run: `git diff --check`

Expected: all pass with no relevant warning or error.

**Step 2: Verify rendered behavior**

- Check the homepage review and the MSFT detail header on desktop and mobile.
- Confirm page identity, meaningful content, no framework overlay, no relevant console errors, and a working position navigation interaction.

**Step 3: Commit, push, package, and deploy**

- Commit the exact validated source, fast-forward `main`, package that HEAD, save one Sites version, deploy privately, and poll to `succeeded`.
- Recheck that access remains `custom`, one owner, zero groups, and zero external visitors.
