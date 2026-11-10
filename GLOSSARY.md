# Glossary

The canonical language for Cadence. UI copy, emails, error messages, code identifiers and DB enums all use these terms. When several words exist for one concept, the term here wins and the rest are listed under _Avoid_.

## People

**Student**:
A user with the student role: someone who buys and takes courses. An instructor or platform admin buying a course is not a case the product designs for.
_Avoid_: Learner, customer, user (when you mean a student)

**Buyer**:
The user who made a purchase: a student buying a course for themselves, or a team admin buying a team licence.
_Avoid_: Customer, purchaser, payer

**Seat holder**:
A student who got access to a course by claiming a seat. They have no purchase of their own, so they never make a refund request.
_Avoid_: Team member, redeemer

**Platform admin**:
A user with the admin role: Cadence staff who run the platform — users, courses, categories and refund requests. In code, `UserRole.Admin`.
_Avoid_: Admin (on its own), staff, superuser

**Team admin**:
The member of a team who bought its team licences and hands out their seats. Not staff, and has no platform admin powers. In code, `TeamMemberRole.Admin`.
_Avoid_: Admin (on its own), team owner, manager

## Teams

**Team licence**:
A purchase a team admin makes of several seats of one course at once. Its amount paid covers all its seats. It gives the team admin no access to the course themselves.
_Avoid_: Team purchase, bulk purchase, license (spelling)

**Seat**:
One place on a team licence, which one person can claim to get access to the course. A seat is available, claimed, on hold or void.
_Avoid_: Coupon, licence (that is the whole purchase)

**Seat link**:
The link a team admin shares so someone can claim a seat.
_Avoid_: Coupon code, redeem link, invite

**Claimed**:
A seat someone has used to get access to the course. It stays claimed for good.
_Avoid_: Redeemed, taken, used

**On hold**:
Every available seat on a team licence that has an open refund request. It can't be claimed. The hold lifts if the refund request is withdrawn or declined.

**Void**:
Every unclaimed seat on a team licence whose refund request was approved. It can never be claimed.

## Refunds

**Purchase**:
A buyer's payment for a course: either their own access to it, or a team licence.

**Amount paid**:
What the buyer was actually charged for a purchase, after any discount.
_Avoid_: Price (that is the course's list price, a different thing)

**Course progress**:
A student's hours watched and lessons completed in a course, counted across all their purchases of it.
_Avoid_: Completion, usage

**Refund window**:
The 14 days after a purchase during which a refund request can be made.
_Avoid_: Cancel window, cooling-off period

**Refund eligibility**:
Whether a purchase can have a refund request made: inside the refund window, and not already a refunded purchase or waiting on an open refund request. A student's own purchase must also be under 2 hours watched and under 50% of lessons completed. A team licence must have no claimed seat; the watch and completion limits don't apply to it. Checked at the moment the request is made, identically in the UI and on the server. A buyer who withdraws a request may make a new one only if the purchase is still eligible.

**Refund request**:
A buyer's ask to have the amount paid for a purchase given back. It always belongs to exactly one purchase. It is open until a reviewer approves or declines it, or the buyer withdraws it.
_Avoid_: Reversal, cancellation, chargeback, refund (on its own)

**Reason**:
The buyer's own explanation on a refund request.

**Open**:
The status of a refund request the team hasn't decided yet, and the buyer hasn't withdrawn. A request a reviewer has looked at but not decided is still open. A student keeps full access to the course while their refund request is open.
_Avoid_: Pending (that word belongs to refunds), requested

**Approved**:
The status of a refund request a reviewer has accepted. Only an approved refund request produces a refund. For a student's own purchase, their access to the course ends at that moment. For a team licence, every unclaimed seat becomes void, and nobody's access changes.

**Declined**:
The status of a refund request a reviewer has turned down. It always carries a decision note.
_Avoid_: Rejected, denied

**Withdrawn**:
The status of a refund request the buyer closed themselves while it was open. It produces no refund.
_Avoid_: Cancelled

**Reviewer**:
A platform admin deciding a refund request. Only platform admins can be reviewers.
_Avoid_: Resolver, admin (when you mean the person deciding a refund request)

**Decision note**:
The reviewer's explanation of their decision on a refund request. Required when declining, optional when approving.
_Avoid_: Reason (that is the buyer's), resolution

**Refund**:
The money given back to the buyer's card after a refund request is approved. It is always the refundable amount.
_Avoid_: Reversal, chargeback

**Pending refund**:
A refund that has been issued but hasn't reached the buyer's card yet. No payment system is connected, so the app never learns when a refund arrives: every refund is shown as pending.
_Avoid_: Pending refund request (a refund request is open, never pending), on its way

**Refundable amount**:
How much a refund for a purchase would be: always the amount paid.
_Avoid_: List price

**Refunded purchase**:
A purchase whose refund has been issued. It no longer grants access to the course. The student keeps their course progress, and may buy the course again.

**Chargeback**:
A dispute the cardholder raises through their bank, which forcibly takes the money back. Not modelled today, and never used to mean a refund request.
