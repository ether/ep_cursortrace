'use strict';

const authorManager = require('ep_etherpad-lite/node/db/AuthorManager');
const padMessageHandler = require('ep_etherpad-lite/node/handler/PadMessageHandler');
const {createCoalescer} = require('./coalescer');

const COALESCE_MS = 100;
// Far beyond any real line count or line length; only bounds what we relay.
const MAX_COORD = 10000000;

const coalescer = createCoalescer({
  windowMs: COALESCE_MS,
  flush: (_key, msg) => {
    try {
      padMessageHandler.handleCustomObjectMessage(msg, false, () => {});
    } catch (err) {
      // Best-effort; do not let a bad message wedge the timer.
      console.error('ep_cursortrace: flush failed', err);
    }
  },
});

// Returns a non-negative integer, or null if the value is not a finite number.
const toCoord = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(MAX_COORD, Math.max(0, Math.trunc(value)));
};

exports.handleMessage = async (hookName, context) => {
  const {message: {type, data = {}} = {}, sessionInfo} = context || {};
  if (type !== 'COLLABROOM' || data == null || data.type !== 'cursor') return;

  const message = data;
  if (message.action !== 'cursorPosition') return null;

  // The author and pad come from the server-side session, never from the
  // message: the client still sends myAuthorId/padId, but they are ignored.
  const {authorId, padId} = sessionInfo || {};
  if (typeof authorId !== 'string' || !authorId) return null;
  if (typeof padId !== 'string' || !padId) return null;

  const locationX = toCoord(message.locationX);
  const locationY = toCoord(message.locationY);
  if (locationX == null || locationY == null) return null;

  const authorName = await authorManager.getAuthorName(authorId);

  const msg = {
    type: 'COLLABROOM',
    data: {
      type: 'CUSTOM',
      payload: {
        action: 'cursorPosition',
        authorId,
        authorName,
        padId,
        locationX,
        locationY,
      },
    },
  };
  // Key by pad as well as author so one author's cursor on one pad does not
  // displace their cursor on another pad within the same window.
  coalescer.submit(`${padId}\u0000${authorId}`, msg);

  return null; // null prevents Etherpad from attempting to process the message any further.
};
