# Glossary

The canonical language for Cadence. UI copy, emails, error messages, code identifiers and DB enums all use these terms. When several words exist for one concept, the term here wins and the rest are listed under _Avoid_.

## People

**Student**:
A user with the student role: someone who buys and takes courses. An instructor or admin buying a course is not a case the product designs for.
_Avoid_: Learner, customer, user (when you mean a student)

## Refunds

**Purchase**:
A student's payment for a course, which grants access to it.

**Amount paid**:
What the student was actually charged for a purchase, after any discount.
_Avoid_: Price (that is the course's list price, a different thing)

**Refund window**:
The 14 days after a purchase during which a refund request can be made.
_Avoid_: Cancel window, cooling-off period

**Refund eligibility**:
Whether a purchase can have a refund request made: inside the refund window, under 2 hours watched, under 50% of lessons completed, and not a claimed team seat — and it is not already a refunded purchase or waiting on an open refund request. Checked at the moment the request is made, identically on the course page and the server. A student who withdraws a request may make a new one only if the purchase is still eligible.

**Refund request**:
A student's ask to have the amount paid for a purchase given back. It is open until a reviewer approves or declines it, or the student withdraws it.
_Avoid_: Reversal, cancellation, chargeback, refund (on its own)

**Reason**:
The student's own explanation on a refund request.

**Open**:
The status of a refund request the team hasn't decided yet, and the student hasn't withdrawn. A request a reviewer has looked at but not decided is still open.
_Avoid_: Pending (that word belongs to refunds), requested

**Approved**:
The status of a refund request a reviewer has accepted. Only an approved refund request produces a refund.

**Declined**:
The status of a refund request a reviewer has turned down. It always carries a decision note.
_Avoid_: Rejected, denied

**Withdrawn**:
The status of a refund request the student closed themselves while it was open. It produces no refund.
_Avoid_: Cancelled

**Reviewer**:
The staff member who approves or declines a refund request.
_Avoid_: Resolver, admin (in this context)

**Decision note**:
The reviewer's explanation of their decision on a refund request. Required when declining, optional when approving.
_Avoid_: Reason (that is the student's), resolution

**Refund**:
The money given back to the student's card after a refund request is approved. It is always the refundable amount.
_Avoid_: Reversal, chargeback

**Pending refund**:
A refund that has been issued but hasn't reached the student's card yet. No payment system is connected, so the app never learns when a refund arrives: every refund is shown as pending.
_Avoid_: Pending refund request (a refund request is open, never pending), on its way

**Refundable amount**:
How much a refund for a purchase would be: always the amount paid.
_Avoid_: List price

**Refunded purchase**:
A purchase whose refund has been issued. It no longer grants access to the course.

**Chargeback**:
A dispute the cardholder raises through their bank, which forcibly takes the money back. Not modelled today, and never used to mean a refund request.
