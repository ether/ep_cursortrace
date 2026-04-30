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
