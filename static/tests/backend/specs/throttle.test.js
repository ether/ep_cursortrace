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

describe('client throttle', function () {
  it('sends the first message immediately', async function () {
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

  it('coalesces a burst into one immediate send plus one trailing send with the latest msg',
      async function () {
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

  it('flush() sends pending immediately and cancels the timer', async function () {
    const sent = [];
    const clock = makeFakeClock();
    const t = createThrottle({
      send: (m) => sent.push(m),
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      windowMs: 100,
    });
    t.submit({x: 1}); // immediate
    t.submit({x: 2}); // pending
    t.flush();
    assert.deepStrictEqual(sent.map((m) => m.x), [1, 2]);
    clock.advance(200);
    assert.strictEqual(sent.length, 2); // timer was cancelled
  });

  it('flush() with nothing pending is a no-op', async function () {
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

  it('never exceeds one send per windowMs under sustained submission',
      async function () {
        const sent = [];
        const clock = makeFakeClock();
        const t = createThrottle({
          send: (m) => sent.push(m),
          now: clock.now,
          setTimeout: clock.setTimeout,
          clearTimeout: clock.clearTimeout,
          windowMs: 100,
        });
        // 100 submits at 10 ms intervals = 1000 ms of submission. Expect
        // exactly 11 sends: 1 immediate at t=0, plus trailing at t=100,200,...,1000.
        for (let i = 0; i < 100; i++) {
          t.submit({x: i});
          clock.advance(10);
        }
        clock.advance(200); // drain any pending trailing timer
        assert.strictEqual(sent.length, 11);
      });
});
