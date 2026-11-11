# Cadence owns the list of push registrations

Knock stores each person's browser push tokens as one list that every write replaces, never prunes old tokens and knows nothing about sign-out. So Cadence keeps its own table of push registrations (person, token, browser label, last seen) as the source of truth, and on every change rewrites that person's whole token list in Knock from the table, through the retrying notification queue. Cadence never reads Knock's list to edit it.

## Considered Options

- **Rely on Knock's list alone, with read-change-write from the server.** Two browsers registering at once can overwrite each other, there is no "last seen" to prune by, and sign-out can't tell which token to remove.
- **Let the browser write its token to Knock directly** (Knock's enhanced security mode). Same overwrite and pruning problems, and the writes escape Cadence's fake in tests.

## Consequences

- The session holds the id of the browser's push registration, so signing out (and DevUI user switching) removes it on the server even if browser JavaScript never runs.
- Registrations not seen for 30 days are deleted. A token Knock dropped after a bounce can be written back from the table until it ages out; a `message.bounced` webhook would close that gap if bounces start costing real message volume.
