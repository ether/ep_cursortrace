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
      for (;;) {
        const dueList = timers
            .filter((h) => !h.cancelled && h.fireAt <= t)
            .sort((a, b) => a.fireAt - b.fireAt);
        if (dueList.length === 0) break;
        const due = dueList[0];
        due.cancelled = true;
        due.fn();
      }
    },
  };
};

describe('coalescer', function () {
  it('flushes the first message immediately', async function () {
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

  it('coalesces a burst into one immediate flush plus one trailing flush with the latest payload',
      async function () {
        const flushed = [];
        const clock = makeFakeClock();
        const c = createCoalescer({
          flush: (authorId, payload) => flushed.push({authorId, payload}),
          now: clock.now,
          setTimeout: clock.setTimeout,
          clearTimeout: clock.clearTimeout,
          windowMs: 100,
        });
        for (let i = 0; i < 50; i++) {
          c.submit('a1', {x: i});
          clock.advance(0);
        }
        assert.strictEqual(flushed.length, 1);
        assert.deepStrictEqual(flushed[0].payload, {x: 0});
        clock.advance(100);
        assert.strictEqual(flushed.length, 2);
        assert.deepStrictEqual(flushed[1], {authorId: 'a1', payload: {x: 49}});
      });

  it('caps at one flush per window per author over time', async function () {
    const flushed = [];
    const clock = makeFakeClock();
    const c = createCoalescer({
      flush: (authorId, payload) => flushed.push({authorId, payload}),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    c.submit('a1', {x: 1}); // immediate flush #1 at t=0, lastFlushedAt=0
    clock.advance(50); // t=50
    c.submit('a1', {x: 2}); // pending, timer at t=100
    clock.advance(60); // t=110, timer fired at t=100 -> flush #2 (x=2)
    c.submit('a1', {x: 3}); // since=10, must coalesce
    assert.strictEqual(flushed.length, 2);
    assert.deepStrictEqual(flushed.map((f) => f.payload.x), [1, 2]);
    clock.advance(100); // t=210, timer fires at t=200 -> flush #3 (x=3)
    assert.strictEqual(flushed.length, 3);
    assert.deepStrictEqual(flushed.map((f) => f.payload.x), [1, 2, 3]);
  });

  it('never exceeds one flush per windowMs under sustained submission', async function () {
    const flushed = [];
    const clock = makeFakeClock();
    const c = createCoalescer({
      flush: (authorId, payload) => flushed.push({authorId, payload}),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    // Submit every 10 ms for 1000 ms (100 submits). Cap is 10 Hz, so we should
    // see at most ~11 flushes (1 immediate + ~10 trailing).
    for (let i = 0; i < 100; i++) {
      c.submit('a1', {x: i});
      clock.advance(10);
    }
    // Drain any pending trailing timer.
    clock.advance(200);
    // 100 submits, 10 ms apart = 1000 ms of submission. With a 100 ms window
    // we expect exactly: 1 immediate flush at t=0, plus a trailing flush at
    // t=100, 200, ..., 1000 = 11 total. Asserting an exact count means a
    // future regression that produces 12 (window-edge double-flush) or 10
    // (a missed trailing flush) fails loudly.
    assert.strictEqual(flushed.length, 11);
  });

  it('tracks authors independently', async function () {
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
    assert.strictEqual(flushed.length, 2);
    assert.deepStrictEqual(flushed.map((f) => f.authorId).sort(), ['a1', 'a2']);
  });

  it('does not wedge if flush throws', async function () {
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
    assert.doesNotThrow(() => c.submit('a1', {x: 2}));
    assert.strictEqual(calls, 2);
  });
});
