# 0001 — Team licence refunds

- **Status:** Accepted, not yet implemented ([#10](https://github.com/laavanya14/cohort-005-project-pooh/issues/10))
- **Date:** 2026-11-10

Terms are as defined in `GLOSSARY.md`.

## Context

A team admin buys a team licence: one purchase whose amount paid covers several seats of one course. The team admin gets no access themselves. They share seat links, and each person who claims a seat becomes a seat holder with access.

The refundable amount is always the amount paid, so a refund can only cover the whole licence. The problem is seats that are claimed, or could still be claimed, when the refund goes through. Before this decision:

- a seat could be claimed while the licence's refund request was open, so approval refunded the full amount while someone was using the course;
- approval left the seats alone, so unclaimed seat links kept working after the refund.

## Decision

**No seat can be in use when a team licence is refunded.**

1. A team licence is eligible for a refund request only while **none of its seats is claimed** (and inside the refund window). The watch and completion limits don't apply, because the team admin isn't taking the course.
2. While its refund request is open, every available seat is **on hold** and can't be claimed. Withdrawn or declined lifts the hold.
3. When the refund request is approved, every unclaimed seat becomes **void**, permanently. Approval changes nobody's enrollment.

## Alternatives considered

**Refunds for some seats only** ("refund 3 of my 5 seats"). This would let a team that used part of a licence get the rest back. Rejected: it breaks *refundable amount = amount paid*, and needs per-seat pricing, partial refunds and a much larger reviewer flow.

**Refund once a seat is claimed, and seat holders lose access.** Rejected: seat holders lose a course they did nothing wrong to lose.

**Refund once a seat is claimed, and seat holders keep access.** Rejected: the team gets its money back and still has seats in use.

**Let seats be claimed while the refund request is open:**
- *The claim closes the refund request automatically.* Rejected: the team admin loses a refund over something they didn't control, and can't see it coming.
- *The reviewer decides, with "N seats claimed since the request" shown.* Rejected: this brings back the refund-while-in-use case that rule 1 rules out.
- *Any claim forces a decline.* Rejected: it turns the request into a race the team admin can lose without knowing.

**Leave seat links working after approval** (the old behaviour). Rejected: the refund would give the money back without taking anything away.

## Consequences

- Seats need a stored state (available, claimed, on hold, void), which means a schema change.
- Someone opening a seat link can be told "on hold" or "no longer available". Both messages tell them to ask the person who sent the link, or say why it no longer works.
- A team that has used even one seat can't get any of its money back through a refund request. That's deliberate. Any exception goes through a person, not the app.
- Because approval deletes no enrollments, a team admin who also bought the course for themselves keeps that access. This relies on each refund request belonging to exactly one purchase.
