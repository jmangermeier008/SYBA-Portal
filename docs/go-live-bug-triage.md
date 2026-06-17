# Go-Live Bug Triage — Deferred Items

Created 2026-06-17 during the football go-live hardening pass. The conservative fixes
A–E and H shipped on the working branch. The items below were **intentionally deferred** —
each changes live money/refund behavior or is otherwise off the go-live critical path.
This doc is the go/no-go record so they can be scheduled deliberately rather than fixed
mid-launch.

For context, the items that **were** fixed in this pass:
- **A** — Season creation writes divisions/teams before the season doc (no orphaned seasons).
- **B** — `handleSetActive` re-queries fresh per sport (exactly one active season per sport).
- **C** — Webhook guards `enrollmentAmounts`/`enrollmentIds` length mismatch (no inflated financials).
- **D** — Zero-fee carts set `fee_waived: false` explicitly.
- **E** — Capacity overbooking fixed with a `reservedCount` reservation counter + auto-release
  (see "Operational requirement" below).
- **H** — Waived manual registrations carry a truthy `waived_<id>` settled marker.

---

## E — Operational requirement (action needed, not code)

Fix E reserves a division seat at Stripe checkout and releases it on payment or on the
**`checkout.session.expired`** event. That event must be **subscribed on the Stripe webhook
endpoint in BOTH test and live mode**, or abandoned carts never release their reserved seat
(the division will appear fuller than it is until an admin runs "Recalculate Counts", which
rebuilds `registeredCount` from enrollments but does not reset `reservedCount`).

- Stripe Dashboard → Developers → Webhooks → (each endpoint) → add event
  `checkout.session.expired`.
- Stripe Checkout sessions expire ~24h after creation by default.
- Manual admin registrations intentionally bypass capacity (admin override) — unchanged.

---

## F (Medium) — Sibling pricing ignores pending enrollments

**Where:** `src/app/api/stripe/checkout/route.ts` (~lines 98-110), the `pastPaidCount` query.

**Impact:** `pastPaidCount` counts only `paid` and `fee_waived` enrollments. A family with a
child whose payment is still `pending_payment` (e.g. they enrolled one child, abandoned
checkout, then enrolled a second child in a separate cart) has that pending child ignored,
so the next child is charged the **full** division fee instead of the flat sibling fee —
an overcharge.

**Why deferred:** The naive fix (also count `pending_payment`) introduces the opposite
risk — a leftover/abandoned pending enrollment for the *same* child would wrongly grant a
sibling discount (revenue loss). A correct fix must **dedupe by `playerId`** (count distinct
players with a paid/waived/genuinely-active-pending enrollment), and it changes charge
amounts — not something to alter during the active launch.

**Proposed real fix:** Count distinct `playerId`s among the family's `paid`/`fee_waived`
enrollments plus *active* (recent, non-abandoned) `pending_payment` ones for the season, and
use that as `pastPaidCount`. Add unit coverage in `tests/unit/registration-logic.test.ts`
(extend `calculateCartPricing` inputs) and a checkout integration check.

---

## G (Medium) — Partial refunds ambiguous for multi-child carts

**Where:** `src/app/api/stripe/webhook/route.ts`, the `charge.refunded` handler
(`if (!charge.refunded)` partial-refund branch, ~lines 269-283).

**Impact:** A Stripe charge covers a whole cart (possibly several children). On a **partial**
refund, Stripe does not say which line item/enrollment it applies to, so the handler records
the event to `paymentEvents` as `needs-attention` and stops. Current behavior is **safe**
(nothing is mis-reverted) but requires manual admin follow-up.

**Why deferred:** Refunds are not on the go-live critical path, and auto-resolving partial
refunds changes refund-status semantics. Only the single-enrollment case is unambiguous.

**Proposed real fix:** When `enrollmentIds.length === 1`, treat a partial refund as applying
to that one enrollment (record the refunded amount; decide whether to flip status to
`refunded` only on a full-fee partial). Leave multi-child carts as manual review. Add a test
for the single-enrollment partial path.

---

## Documentation discrepancy — role booleans (RESOLVED)

`CLAUDE.md` (Role System section) previously documented `useUser()` as returning
`isAdmin / isSiteAdmin / isBoardMember / isCoach / isParent`. In the current code, `useUser()`
(`src/firebase/auth/use-user.tsx`) returns `user`, `profile`, `loading`, and `isSiteAdmin`
only. The **per-sport** role booleans (`isAdmin`, `isBoardMember`, `isCoach`, `isParent`) are
derived in `useSport()` (`src/firebase/sport-context.tsx`) because they depend on the active
sport (and honor the sandbox-role override). Components already read them from `useSport()`.

**Resolved:** `CLAUDE.md` Role System section updated to split the two hooks. No code change.
