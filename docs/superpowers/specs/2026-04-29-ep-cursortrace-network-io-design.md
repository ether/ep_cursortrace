# ep_cursortrace network IO redesign

**Date:** 2026-04-29
**Status:** Draft — approved in brainstorm, awaiting written-spec review

## Problem

`ep_cursortrace` currently emits one socket message per `aceEditEvent` whenever
the caret position has changed. The trigger set includes `idleWorkTimer`, which
fires on a continuous tick regardless of user activity. The server-side handler
is a thin relay with a `// Todo write some buffer handling` stub: every inbound
`cursor` message is rebroadcast to the entire pad room via
`padMessageHandler.handleCustomObjectMessage`, after a 500 ms `setTimeout` that
delays delivery without reducing volume.

Effect on upstream Etherpad CI: the high message rate makes timing-sensitive
core tests flaky (timeouts, ordering asserts). The plugin therefore breaks
upstream CI any time it is included in a test environment.

## Goals

- Cut wire volume to roughly **10 msg/s/user**, regardless of how fast the
  caret moves.
- Provide that cap in **two independent layers** (client throttle + server
  coalescer), so an old or buggy client cannot reintroduce the regression.
- Preserve the existing wire format, hook names, and renderer — the change is
  purely about volume.

## Non-goals

- No protocol change, no Etherpad-core change.
- No new configuration surface.
- No change to the visual rendering of remote cursors.

## Architecture

```
[caret moves] -> client throttle (100 ms, trailing)
              -> socket
              -> server coalescer (100 ms, per-author, latest-wins)
              -> padMessageHandler.handleCustomObjectMessage
              -> other clients (renderer unchanged)
```

Both layers use **trailing-edge, latest-wins** coalescing so the resting cursor
position is always the one that gets broadcast.

## Client changes (`static/js/main.js`)

### Trigger set

`aceEditEvent` currently treats three event types as caret movement:

```js
const caretMoving = ((args.callstack.editEvent.eventType === 'handleClick') ||
    (args.callstack.type === 'handleKeyEvent') || (args.callstack.type === 'idleWorkTimer'));
```

Drop `idleWorkTimer`. Clicks and key events are sufficient signals that the
caret moved; the idle timer fires on a tick and is the primary source of
spurious work. The existing position-equality guard
(`if (!last || Y !== last[0] || X !== last[1])`) stays as a cheap early-out.

### Trailing throttle

A small module-level helper with three pieces of state:

- `pendingMessage` — latest message we have not yet sent
- `lastSentAt` — timestamp of the last actual send
- `timer` — single `setTimeout` handle, or `null`

On each candidate send:

1. If `now - lastSentAt >= 100 ms`: send immediately, update `lastSentAt`,
   clear `pendingMessage`.
2. Otherwise: store the message as `pendingMessage`. If `timer` is `null`,
   schedule one for the remaining window. The timer's callback flushes
   whatever `pendingMessage` holds at fire time, updates `lastSentAt`, and
   clears both `pendingMessage` and `timer`.

Constants: `THROTTLE_MS = 100`. No config knob.

### Flush on unload

Add a `beforeunload` listener that flushes `pendingMessage` synchronously, so
the resting cursor position is broadcast when the user closes the tab. Cheap;
no new state.

## Server changes (`handleMessage.js`)

Replace the `bufferAllows = true` stub and the 500 ms `setTimeout` with a
per-author coalescer.

State (module-scoped):

- `pending: Map<authorId, {msg, padId}>` — latest pending message per author
- `lastFlushedAt: Map<authorId, number>`
- `timers: Map<authorId, TimeoutHandle>`

On each incoming `cursor` message:

1. If `now - (lastFlushedAt.get(authorId) ?? 0) >= 100 ms`: flush immediately
   (call `handleCustomObjectMessage`), update `lastFlushedAt`, ensure no
   `pending` entry remains for this author.
2. Otherwise: overwrite `pending.get(authorId)` with the latest message. If
   no timer is scheduled for this author, schedule one for the remaining
   window. The timer's callback flushes the entry, updates `lastFlushedAt`,
   and deletes the `pending` and `timers` entries for this author.

Constants: `COALESCE_MS = 100`.

The 500 ms `setTimeout` ("editor hasn't redrawn by the time the cursor has
arrived") is removed: the client throttle plus server coalesce already
introduce ~200 ms of natural slack, and the receiver already guards against
missing DOM lines via `if (div.length !== 0)`.

### Memory hygiene

`pending` and `timers` entries are deleted on every flush. `lastFlushedAt`
must persist across flushes (it is what gates the throttle), so that map
grows by one timestamp per author who has ever sent a cursor message in
this process's lifetime. The footprint is bounded by author count, not by
message rate, and is small enough not to need an eviction policy. No
`userLeave` hook is needed.

### Error handling

If `handleCustomObjectMessage` throws synchronously, log and clear the
author's entries rather than letting a bad message wedge the per-author
timer. This matches the current posture (the existing callback is a no-op
`// TODO: Error handling`).

## Testing

All tests live in the plugin's own suite. No upstream changes.

1. **Server unit, single author burst.** Inject a fake clock and a stub for
   `handleCustomObjectMessage`. Feed 50 `cursor` messages within 10 ms of
   simulated time from one author. Assert: exactly **1** call to the stub,
   and the call carries the position from the *last* injected message.
   Advance the clock by 100 ms, inject one more message. Assert **2** total
   calls.
2. **Server unit, multi-author independence.** Two authors flooding in
   parallel are coalesced independently. Each gets its own 10 Hz cap; one
   author's traffic does not drop the other's.
3. **Playwright integration.** Open two clients on the same pad. On client A,
   programmatically move the caret across many lines for ~1 s. Count
   `COLLABROOM` frames with `data.payload.action === 'cursorPosition'`
   received on client B. Assert `<= 12` (≈10 Hz over 1 s plus slack). This
   is the regression test for the upstream-CI flake.

Run headless (per project convention — never `--headed`).

## Expected impact

- Worst-case wire volume drops from `idleWorkTimer`-paced (~30–60 Hz on
  active machines) to ≤10 Hz/user.
- Server is bounded independently of client behavior.
- Upstream CI runs that include the plugin should stop hitting the timing
  flake described in the problem statement.

## Out of scope

- Smoothing / interpolation of remote cursors on the receiver.
- Sending cursor selections (range, not just point) — the current plugin
  only ships a point and we are not changing that here.
- A configurable rate; if 10 Hz proves wrong, that is a follow-up.
