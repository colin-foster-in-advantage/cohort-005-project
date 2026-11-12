# The Notification Feed talks to Knock from the browser

Every other third-party call in Cadence is made server-side, but the Notification Feed has to stay current without a page refresh, and Knock offers exactly one way to do that: a WebSocket opened by the browser directly to Knock, using the public API key and the Knock user id. So the Feed is client-owned end to end — no route loader reads Knock, the browser holds the connection, and mark-seen / mark-read / archive are written straight from the browser through the same client.

## Considered Options

The alternative was to proxy: our server holds one Knock socket per signed-in user and re-broadcasts to the browser over SSE, keeping every Knock credential and call server-side. That would have preserved the "one server module for all Knock calls" boundary, but it means operating a connection-fanout service inside a React Router app that has no such machinery, and it adds a second socket that can fail independently of Knock's. Rejected as strictly more moving parts in defence of a one-file swap boundary.

## Consequences

- Knock now lives in two modules, not one: a server module for triggering and preferences, and a client module that owns the feed connection. A vendor swap touches both.
- The Knock public API key is served to the browser. With enhanced security mode off it can read any user's feed, which is the exposure [#21](https://github.com/colin-foster-in-advantage/cohort-005-project/issues/21) exists to close.
- Because no loader depends on Knock, the Feed cannot slow down or break any page in Cadence — but it does require JavaScript.
- Knock's client drops the socket 30 seconds into a hidden tab and does not catch up on reconnect, so Cadence re-reads the feed on `visibilitychange` and `online`. That re-read, not the socket, is the correctness guarantee.
- The feed client is keyed on the Knock user id so a DevUI user switch tears down the previous user's connection structurally rather than by cleanup.
