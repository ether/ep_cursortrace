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
  const pending = new Map();
  const lastFlushedAt = new Map();
  const timers = new Map();

  const doFlush = (authorId) => {
    const payload = pending.get(authorId);
    pending.delete(authorId);
    timers.delete(authorId);
    lastFlushedAt.set(authorId, now());
    try {
      flush(authorId, payload);
    } catch (err) {
      // Swallow so a bad message does not wedge this author's timer.
    }
  };

  return {
    submit: (authorId, payload) => {
      const neverFlushed = !lastFlushedAt.has(authorId);
      const since = neverFlushed ? windowMs : now() - lastFlushedAt.get(authorId);
      if (since >= windowMs) {
        const t = timers.get(authorId);
        if (t) { clearTimeoutFn(t); timers.delete(authorId); }
        pending.set(authorId, payload);
        doFlush(authorId);
        return;
      }
      pending.set(authorId, payload);
      if (!timers.has(authorId)) {
        const remaining = windowMs - since;
        const handle = setTimeoutFn(() => doFlush(authorId), remaining);
        timers.set(authorId, handle);
      }
    },
  };
};
