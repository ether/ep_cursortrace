# ep_cursortrace network IO redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap cursor-position broadcast volume at ~10 Hz/user with two layers of trailing-edge, latest-wins coalescing (client throttle + server coalescer), so upstream Etherpad CI is no longer flaky when ep_cursortrace is installed.

**Architecture:** Two small pure-JS helpers — `coalescer.js` (server) and `static/js/throttle.js` (client) — each implementing the same "send first, then at most one trailing send per window" pattern with an injectable clock for testability. The existing `handleMessage.js` and `static/js/main.js` become thin wiring around them. Wire format and renderer are unchanged.

**Tech Stack:** Node ≥18, plain JS (no TypeScript, no build step), mocha for unit tests, Playwright for the integration regression test. Etherpad core supplies `require_kernel` for client-side `require`.

**Spec:** `docs/superpowers/specs/2026-04-29-ep-cursortrace-network-io-design.md`

---

## File Structure

- `coalescer.js` — **new**, server. Exports a factory `createCoalescer({ flush, now, setTimeout, clearTimeout, windowMs })` returning `{ submit(authorId, payload), _state }`. No Etherpad imports.
- `handleMessage.js` — **modify**. Remove the 500 ms `setTimeout` and the `bufferAllows` stub. Construct a single module-level coalescer whose `flush` calls `padMessageHandler.handleCustomObjectMessage`.
- `static/js/throttle.js` — **new**, client. Exports a factory `createThrottle({ send, now, setTimeout, clearTimeout, windowMs })` returning `{ submit(message), flush() }`. Plain CommonJS so it works under Etherpad's `require_kernel` and under node.
- `static/js/main.js` — **modify**. Drop `idleWorkTimer` from `caretMoving`; route sends through the throttle; flush on `beforeunload`.
- `static/tests/backend/specs/coalescer.test.js` — **new**. Mocha unit tests for the coalescer.
- `static/tests/backend/specs/throttle.test.js` — **new**. Mocha unit tests for the client throttle (pure JS, runs under node).
- `static/tests/frontend/specs/cursortrace-rate-cap.spec.js` — **new**. Playwright integration test counting broadcast frames over 1 s of caret motion.

---

## Task 1: Server coalescer module (pure logic, TDD)

**Files:**
- Create: `coalescer.js`
- Test: `static/tests/backend/specs/coalescer.test.js`

- [ ] **Step 1: Write the failing tests**

Create `static/tests/backend/specs/coalescer.test.js`:

```js
'use strict';

const assert = require('assert');
const {createCoalescer} = require('../../../../coalescer');

const makeFakeClock = () => {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const handle = {fn, fireAt: t + ms, cancelled: false};
      timers.push(handle);
      return handle;
    },
    clearTimeout: (handle) => { if (handle) handle.cancelled = true; },
    advance: (ms) => {
      t += ms;
      // Fire any timers whose fireAt <= t, in order, allowing new ones to be scheduled.
      for (;;) {
        const due = timers.find((h) => !h.cancelled && h.fireAt <= t);
        if (!due) break;
        due.cancelled = true;
        due.fn();
      }
    },
  };
};

describe('coalescer', () => {
  it('flushes the first message immediately', () => {
    const flushed = [];
    const clock = makeFakeClock();
    const c = createCoalescer({
      flush: (authorId, payload) => flushed.push({authorId, payload}),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    c.submit('a1', {x: 1});
    assert.strictEqual(flushed.length, 1);
    assert.deepStrictEqual(flushed[0], {authorId: 'a1', payload: {x: 1}});
  });

  it('coalesces a burst into a single trailing flush carrying the latest payload', () => {
    const flushed = [];
    const clock = makeFakeClock();
    const c = createCoalescer({
      flush: (authorId, payload) => flushed.push({authorId, payload}),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    // 50 messages within 10 ms of simulated time.
    for (let i = 0; i < 50; i++) {
      c.submit('a1', {x: i});
      clock.advance(0); // no time passes
    }
    // First was flushed immediately; the rest are pending.
    assert.strictEqual(flushed.length, 1);
    assert.deepStrictEqual(flushed[0].payload, {x: 0});
    // Advance past the window — one trailing flush with the latest payload.
    clock.advance(100);
    assert.strictEqual(flushed.length, 2);
    assert.deepStrictEqual(flushed[1], {authorId: 'a1', payload: {x: 49}});
  });

  it('caps at one flush per window per author over time', () => {
    const flushed = [];
    const clock = makeFakeClock();
    const c = createCoalescer({
      flush: (authorId, payload) => flushed.push({authorId, payload}),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    c.submit('a1', {x: 1});           // immediate flush #1
    clock.advance(50);
    c.submit('a1', {x: 2});           // pending
    clock.advance(60);                // crosses window — trailing flush #2
    c.submit('a1', {x: 3});           // immediate flush #3 (window already elapsed)
    assert.strictEqual(flushed.length, 3);
    assert.deepStrictEqual(flushed.map((f) => f.payload.x), [1, 2, 3]);
  });

  it('tracks authors independently', () => {
    const flushed = [];
    const clock = makeFakeClock();
    const c = createCoalescer({
      flush: (authorId, payload) => flushed.push({authorId, payload}),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    c.submit('a1', {x: 1});
    c.submit('a2', {x: 1});
    // Both authors get an immediate flush; they do not block each other.
    assert.strictEqual(flushed.length, 2);
    assert.deepStrictEqual(
        flushed.map((f) => f.authorId).sort(),
        ['a1', 'a2'],
    );
  });

  it('does not wedge if flush throws', () => {
    let calls = 0;
    const clock = makeFakeClock();
    const c = createCoalescer({
      flush: () => { calls++; throw new Error('boom'); },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    assert.doesNotThrow(() => c.submit('a1', {x: 1}));
    clock.advance(150);
    // After the window passes the author can submit again.
    assert.doesNotThrow(() => c.submit('a1', {x: 2}));
    assert.strictEqual(calls, 2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /home/jose/etherpad/ep_cursortrace
npx mocha static/tests/backend/specs/coalescer.test.js
```
Expected: FAIL — `Cannot find module '../../../../coalescer'`.

- [ ] **Step 3: Implement the coalescer**

Create `coalescer.js`:

```js
'use strict';

/**
 * Per-author trailing-edge, latest-wins coalescer.
 *
 * Contract: for each authorId, `flush(authorId, payload)` is called at most
 * once per `windowMs`. The payload delivered is the most recent one submitted
 * within (or at the boundary of) that window.
 */
exports.createCoalescer = ({
  flush,
  now = Date.now,
  setTimeout: setTimeoutFn = setTimeout,
  clearTimeout: clearTimeoutFn = clearTimeout,
  windowMs = 100,
}) => {
  const pending = new Map();        // authorId -> latest payload
  const lastFlushedAt = new Map();  // authorId -> ms timestamp
  const timers = new Map();         // authorId -> timer handle

  const doFlush = (authorId) => {
    const payload = pending.get(authorId);
    pending.delete(authorId);
    timers.delete(authorId);
    lastFlushedAt.set(authorId, now());
    try {
      flush(authorId, payload);
    } catch (err) {
      // Swallow so a bad message does not wedge this author's timer.
      // Caller is expected to log if needed.
    }
  };

  return {
    submit: (authorId, payload) => {
      const last = lastFlushedAt.get(authorId) || 0;
      const since = now() - last;
      if (since >= windowMs) {
        // No active window — flush immediately.
        // If a timer somehow exists, cancel it.
        const t = timers.get(authorId);
        if (t) { clearTimeoutFn(t); timers.delete(authorId); }
        pending.set(authorId, payload);
        doFlush(authorId);
        return;
      }
      // Within window — store latest, ensure a single trailing timer.
      pending.set(authorId, payload);
      if (!timers.has(authorId)) {
        const remaining = windowMs - since;
        const handle = setTimeoutFn(() => doFlush(authorId), remaining);
        timers.set(authorId, handle);
      }
    },
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx mocha static/tests/backend/specs/coalescer.test.js
```
Expected: PASS — 5 passing.

- [ ] **Step 5: Lint**

```bash
pnpm run lint
```
Expected: no errors. Fix any reported issues before committing.

- [ ] **Step 6: Commit**

```bash
git add coalescer.js static/tests/backend/specs/coalescer.test.js
git commit -m "feat(server): add per-author trailing coalescer"
```

---

## Task 2: Wire coalescer into `handleMessage.js`

**Files:**
- Modify: `handleMessage.js` (replaces current `sendToRoom` + 500 ms `setTimeout`)

- [ ] **Step 1: Replace `handleMessage.js` end-to-end**

Overwrite `handleMessage.js` with:

```js
'use strict';

const authorManager = require('ep_etherpad-lite/node/db/AuthorManager');
const padMessageHandler = require('ep_etherpad-lite/node/handler/PadMessageHandler');
const {createCoalescer} = require('./coalescer');

const COALESCE_MS = 100;

const coalescer = createCoalescer({
  windowMs: COALESCE_MS,
  flush: (_authorId, msg) => {
    try {
      padMessageHandler.handleCustomObjectMessage(msg, false, () => {});
    } catch (err) {
      // Best-effort; do not let a bad message wedge the timer.
      console.error('ep_cursortrace: flush failed', err);
    }
  },
});

exports.handleMessage = async (hookName, context) => {
  const {message: {type, data = {}} = {}} = context || {};
  if (type !== 'COLLABROOM' || data.type !== 'cursor') return;

  const message = data;
  if (message.action !== 'cursorPosition') return null;

  const authorName = await authorManager.getAuthorName(message.myAuthorId);

  const msg = {
    type: 'COLLABROOM',
    data: {
      type: 'CUSTOM',
      payload: {
        action: 'cursorPosition',
        authorId: message.myAuthorId,
        authorName,
        padId: message.padId,
        locationX: message.locationX,
        locationY: message.locationY,
      },
    },
  };
  coalescer.submit(message.myAuthorId, msg);

  return null; // null prevents Etherpad from attempting to process the message any further.
};
```

Notes for the engineer:
- The 500 ms `setTimeout` is gone on purpose; the spec section "Server changes" explains why (client throttle + 100 ms coalesce already give ~200 ms of slack, and the receiver guards on `if (div.length !== 0)`).
- `handleCustomObjectMessage`'s third arg is a callback the receiving side ignores; we pass `() => {}`.

- [ ] **Step 2: Re-run the coalescer tests**

```bash
npx mocha static/tests/backend/specs/coalescer.test.js
```
Expected: PASS — still 5 passing (no regression).

- [ ] **Step 3: Lint**

```bash
pnpm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add handleMessage.js
git commit -m "feat(server): coalesce cursor broadcasts at 10 Hz per author"
```

---

## Task 3: Client throttle module (pure logic, TDD)

**Files:**
- Create: `static/js/throttle.js`
- Test: `static/tests/backend/specs/throttle.test.js` (runs under node — pure JS, no DOM)

- [ ] **Step 1: Write the failing tests**

Create `static/tests/backend/specs/throttle.test.js`:

```js
'use strict';

const assert = require('assert');
const {createThrottle} = require('../../../js/throttle');

const makeFakeClock = () => {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const handle = {fn, fireAt: t + ms, cancelled: false};
      timers.push(handle);
      return handle;
    },
    clearTimeout: (handle) => { if (handle) handle.cancelled = true; },
    advance: (ms) => {
      t += ms;
      for (;;) {
        const due = timers.find((h) => !h.cancelled && h.fireAt <= t);
        if (!due) break;
        due.cancelled = true;
        due.fn();
      }
    },
  };
};

describe('client throttle', () => {
  it('sends the first message immediately', () => {
    const sent = [];
    const clock = makeFakeClock();
    const t = createThrottle({
      send: (m) => sent.push(m),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    t.submit({x: 1});
    assert.deepStrictEqual(sent, [{x: 1}]);
  });

  it('coalesces a burst into one trailing send carrying the latest message', () => {
    const sent = [];
    const clock = makeFakeClock();
    const t = createThrottle({
      send: (m) => sent.push(m),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    for (let i = 0; i < 20; i++) t.submit({x: i});
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(sent[0], {x: 0});
    clock.advance(100);
    assert.strictEqual(sent.length, 2);
    assert.deepStrictEqual(sent[1], {x: 19});
  });

  it('flush() sends pending immediately and cancels the timer', () => {
    const sent = [];
    const clock = makeFakeClock();
    const t = createThrottle({
      send: (m) => sent.push(m),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    t.submit({x: 1});           // immediate
    t.submit({x: 2});           // pending
    t.flush();
    assert.deepStrictEqual(sent.map((m) => m.x), [1, 2]);
    clock.advance(200);
    // Timer was cancelled; no extra send.
    assert.strictEqual(sent.length, 2);
  });

  it('flush() with nothing pending is a no-op', () => {
    const sent = [];
    const clock = makeFakeClock();
    const t = createThrottle({
      send: (m) => sent.push(m),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    t.flush();
    assert.strictEqual(sent.length, 0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /home/jose/etherpad/ep_cursortrace
npx mocha static/tests/backend/specs/throttle.test.js
```
Expected: FAIL — `Cannot find module '../../../js/throttle'`.

- [ ] **Step 3: Implement the throttle**

Create `static/js/throttle.js`:

```js
'use strict';

/**
 * Trailing-edge, latest-wins throttle. Sends the first message immediately,
 * then at most one trailing message per `windowMs` carrying the latest
 * payload submitted during that window.
 *
 * Pure JS — no DOM/jQuery — so it runs under both Etherpad's require_kernel
 * and node-mocha.
 */
exports.createThrottle = ({
  send,
  now = Date.now,
  setTimeout: setTimeoutFn = setTimeout,
  clearTimeout: clearTimeoutFn = clearTimeout,
  windowMs = 100,
}) => {
  let pending = null;
  let lastSentAt = 0;
  let timer = null;

  const doSend = () => {
    const msg = pending;
    pending = null;
    timer = null;
    lastSentAt = now();
    if (msg !== null) send(msg);
  };

  return {
    submit: (msg) => {
      const since = now() - lastSentAt;
      if (since >= windowMs) {
        if (timer) { clearTimeoutFn(timer); timer = null; }
        pending = msg;
        doSend();
        return;
      }
      pending = msg;
      if (!timer) {
        const remaining = windowMs - since;
        timer = setTimeoutFn(doSend, remaining);
      }
    },
    flush: () => {
      if (timer) { clearTimeoutFn(timer); timer = null; }
      if (pending !== null) doSend();
    },
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx mocha static/tests/backend/specs/throttle.test.js
```
Expected: PASS — 4 passing.

- [ ] **Step 5: Lint**

```bash
pnpm run lint
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add static/js/throttle.js static/tests/backend/specs/throttle.test.js
git commit -m "feat(client): add trailing throttle helper"
```

---

## Task 4: Wire throttle into `static/js/main.js`, drop `idleWorkTimer`

**Files:**
- Modify: `static/js/main.js` lines 1-70 only (renderer below stays untouched)

- [ ] **Step 1: Apply edits**

At the top of the file, after the `'use strict';` and existing module-level lets, add:

```js
const {createThrottle} = require('ep_cursortrace/static/js/throttle');

const THROTTLE_MS = 100;
let cursorThrottle = null;

const sendCursor = (message) => {
  pad.collabClient.sendMessage(message);
};
```

Replace the current `aceEditEvent` (lines 39–70 in the pre-change file) with:

```js
exports.aceEditEvent = (hook_name, args) => {
  // Drop idleWorkTimer: it ticks even when nothing has changed and is the
  // primary source of socket spam. Click + key events are sufficient signal.
  const caretMoving = ((args.callstack.editEvent.eventType === 'handleClick') ||
      (args.callstack.type === 'handleKeyEvent'));
  if (!caretMoving || !initiated) return;

  const Y = args.rep.selStart[0];
  const X = args.rep.selStart[1];
  if (last && Y === last[0] && X === last[1]) return;
  last = [Y, X];

  const message = {
    type: 'cursor',
    action: 'cursorPosition',
    locationY: Y,
    locationX: X,
    padId: pad.getPadId(),
    myAuthorId: pad.getUserId(),
  };

  if (!cursorThrottle) {
    cursorThrottle = createThrottle({send: sendCursor, windowMs: THROTTLE_MS});
  }
  cursorThrottle.submit(message);
};
```

Notes for the engineer:
- `idleWorkTimer` is intentionally dropped; this is the core volume fix (see spec).
- `cursorThrottle` is lazily created so we use `pad` only after `postAceInit`.
- The renderer (`handleClientMessage_CUSTOM`) and helpers below stay exactly as they are.

- [ ] **Step 2: Re-run all existing unit tests**

```bash
npx mocha static/tests/backend/specs/coalescer.test.js static/tests/backend/specs/throttle.test.js
```
Expected: PASS — 9 passing total. (Confirms no shared-state regressions.)

- [ ] **Step 3: Lint**

```bash
pnpm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add static/js/main.js
git commit -m "feat(client): throttle cursor messages, drop idleWorkTimer trigger"
```

---

## Task 5: Flush on `beforeunload`

**Files:**
- Modify: `static/js/main.js` (`postAceInit`)

- [ ] **Step 1: Apply edit**

Replace the current `postAceInit` body with:

```js
exports.postAceInit = (hook_name, args, cb) => {
  initiated = true;
  window.addEventListener('beforeunload', () => {
    if (cursorThrottle) cursorThrottle.flush();
  });
  cb();
};
```

Notes:
- This guarantees the resting cursor position is broadcast on tab close, even if it landed inside a throttle window.
- The throttle's `flush()` is a no-op when nothing is pending, so this is safe under all conditions.

- [ ] **Step 2: Lint**

```bash
pnpm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add static/js/main.js
git commit -m "feat(client): flush throttled cursor on tab close"
```

---

## Task 6: Playwright integration test for the rate cap

**Files:**
- Create: `static/tests/frontend/specs/cursortrace-rate-cap.spec.js`

This is the regression test for the upstream-CI flake described in the spec. It opens two clients on the same pad, drives caret motion on one, and verifies the other does not receive more than ~12 cursor frames over ~1 s.

- [ ] **Step 1: Write the test**

Create `static/tests/frontend/specs/cursortrace-rate-cap.spec.js`:

```js
'use strict';

const {test, expect} = require('@playwright/test');

// Etherpad core's playwright config provides a base URL pointing at the dev
// server started by the workflow (`pnpm run dev` on port 9001).

test('ep_cursortrace caps broadcast rate at ~10 Hz', async ({browser}) => {
  const padId = `cursortrace-rate-${Date.now()}`;
  const padUrl = `/p/${padId}`;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto(padUrl);
  await b.goto(padUrl);

  // Wait for both editors to be ready.
  for (const page of [a, b]) {
    await page.waitForSelector('iframe[name="ace_outer"]');
    const outer = page.frameLocator('iframe[name="ace_outer"]');
    await outer.locator('iframe[name="ace_inner"]').waitFor();
  }

  // Seed pad with multiple lines so the caret has somewhere to move.
  const innerA = a.frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]');
  await innerA.locator('#innerdocbody').click();
  for (let i = 0; i < 20; i++) {
    await a.keyboard.type(`line ${i}`);
    await a.keyboard.press('Enter');
  }

  // Wait until B has received the edits (line count stabilises).
  await b.waitForTimeout(500);

  // Install a counter on B that increments on every cursortrace frame.
  await b.evaluate(() => {
    window.__cursorFrames = 0;
    const orig = window.pad.collabClient.handleMessageFromServer;
    window.pad.collabClient.handleMessageFromServer = function (msg) {
      const data = msg && msg.data;
      const payload = data && data.payload;
      if (data && data.type === 'CUSTOM' &&
          payload && payload.action === 'cursorPosition') {
        window.__cursorFrames += 1;
      }
      return orig.apply(this, arguments);
    };
  });

  // On A, drag the caret rapidly across many lines for ~1 s.
  // 30 keypresses with 30 ms between them = ~900 ms of motion.
  await innerA.locator('#innerdocbody').click();
  const start = Date.now();
  for (let i = 0; i < 30; i++) {
    await a.keyboard.press(i % 2 === 0 ? 'ArrowDown' : 'ArrowUp');
    await a.waitForTimeout(30);
  }
  const elapsed = Date.now() - start;

  // Allow the trailing flush to land.
  await b.waitForTimeout(250);

  const frames = await b.evaluate(() => window.__cursorFrames);

  // Cap is 10 Hz on the client + 10 Hz on the server. Over ~1 s, B should see
  // no more than ~12 frames (10 Hz + slack for window-edge effects).
  expect(frames).toBeLessThanOrEqual(12);
  // Sanity: at least one frame got through (the feature still works).
  expect(frames).toBeGreaterThan(0);

  // Telemetry for debugging when this fails:
  console.log(`cursortrace frames=${frames} over ${elapsed} ms`);

  await ctxA.close();
  await ctxB.close();
});
```

Notes for the engineer:
- Etherpad core's playwright config globs plugin specs under `static/tests/frontend/specs/`. If pickup does not work, check `etherpad-lite/src/playwright.config.ts` for the testDir/glob and adjust accordingly. As of 2026-04-28 the convention is the path used above.
- Run headless only (project rule — never `--headed`, never steal user focus).

- [ ] **Step 2: Run the test locally**

```bash
# From an etherpad-lite checkout with this plugin installed:
cd etherpad-lite
pnpm run dev &
# wait for http://localhost:9001 to be reachable
cd src
pnpm exec playwright test --project=chromium \
  ../node_modules/ep_cursortrace/static/tests/frontend/specs/cursortrace-rate-cap.spec.js
```
Expected: PASS. `frames` reported in console should be in roughly the 1–12 range.

- [ ] **Step 3: Commit**

```bash
git add static/tests/frontend/specs/cursortrace-rate-cap.spec.js
git commit -m "test: cap on broadcast cursor frame rate"
```

---

## Task 7: Final verification & PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full local test matrix**

```bash
cd /home/jose/etherpad/ep_cursortrace
pnpm run lint
npx mocha static/tests/backend/specs/coalescer.test.js static/tests/backend/specs/throttle.test.js
```
Expected: lint clean; 9 unit tests pass.

- [ ] **Step 2: Run the Playwright spec against an Etherpad core checkout**

Per the project rule "Always run backend/frontend tests and ts-check locally before pushing." Use the commands from Task 6 Step 2. Expected: PASS.

- [ ] **Step 3: Open a PR on the plugin repo (committed directly per memory: ep_* plugins can be committed directly)**

PR description must declare semver impact. This is a behavior change (drops `idleWorkTimer` trigger, removes 500 ms delay), so:
- Label: **patch** (no API change, no breaking config). Behavior change is internal to the plugin.
- Body must include: spec link, plan link, before/after frame-rate numbers from the Playwright run.
- Per memory: post `/review` comment after every push to trigger Qodo re-review; update PR title/description on every push.

---

## Self-review notes

- **Spec coverage:** Spec sections "Trigger set", "Trailing throttle", "Flush on unload", server "coalescer", "Memory hygiene", "Error handling", and all three test items are covered by Tasks 1–6. The 500 ms `setTimeout` removal is in Task 2.
- **Placeholder scan:** Done — no TBDs, every code step shows full code.
- **Type/name consistency:** `createCoalescer` / `createThrottle` factory shape is consistent. `windowMs` is the same name on both. `submit()` is the public API on both. `flush()` only exists on the client throttle (used for `beforeunload`), which matches the spec.
- **Memory hygiene caveat:** The spec acknowledges `lastFlushedAt` persists across flushes; the implementation in Task 1 matches that — `pending` and `timers` are deleted on every flush, `lastFlushedAt` is not.
