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
  let everSent = false;
  let timer = null;

  const doSend = () => {
    const msg = pending;
    pending = null;
    timer = null;
    lastSentAt = now();
    everSent = true;
    if (msg != null) send(msg);
  };

  return {
    submit: (msg) => {
      const since = everSent ? now() - lastSentAt : windowMs;
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
      if (pending != null) doSend();
    },
  };
};
