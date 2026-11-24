'use strict';

const assert = require('assert');
const authorManager = require('ep_etherpad-lite/node/db/AuthorManager');
const padMessageHandler = require('ep_etherpad-lite/node/handler/PadMessageHandler');
const {handleMessage} = require('../../../../handleMessage');

describe(__filename, function () {
  let sent;
  let nameLookups;
  let origSend;
  let origGetName;
  let n = 0;
  // A fresh author per test so the coalescer flushes the first message at once.
  const uniqueAuthor = () => `a.cursortrace${Date.now()}x${n++}`;

  const cursorMessage = (data) => ({
    type: 'COLLABROOM',
    data: {type: 'cursor', action: 'cursorPosition', locationX: 3, locationY: 2, ...data},
  });

  before(async function () {
    origSend = padMessageHandler.handleCustomObjectMessage;
    origGetName = authorManager.getAuthorName;
    padMessageHandler.handleCustomObjectMessage = (msg) => { sent.push(msg); };
    authorManager.getAuthorName = async (id) => { nameLookups.push(id); return `name of ${id}`; };
  });

  after(async function () {
    padMessageHandler.handleCustomObjectMessage = origSend;
    authorManager.getAuthorName = origGetName;
  });

  beforeEach(async function () {
    sent = [];
    nameLookups = [];
  });

  it('takes author and pad from the session, not the message', async function () {
    const authorId = uniqueAuthor();
    const res = await handleMessage('handleMessage', {
      message: cursorMessage({myAuthorId: 'a.someoneElse', padId: 'otherPad'}),
      sessionInfo: {authorId, padId: 'myPad', readOnly: false},
    });
    assert.strictEqual(res, null);
    assert.strictEqual(sent.length, 1);
    const {payload} = sent[0].data;
    assert.strictEqual(payload.authorId, authorId);
    assert.strictEqual(payload.padId, 'myPad');
    assert.strictEqual(payload.authorName, `name of ${authorId}`);
    assert.deepStrictEqual(nameLookups, [authorId]);
    assert.strictEqual(payload.locationX, 3);
    assert.strictEqual(payload.locationY, 2);
  });

  it('still relays cursors from read-only sessions', async function () {
    const authorId = uniqueAuthor();
    await handleMessage('handleMessage', {
      message: cursorMessage({}),
      sessionInfo: {authorId, padId: 'myPad', readOnly: true},
    });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].data.payload.padId, 'myPad');
  });

  it('drops the message when there is no session author or pad', async function () {
    for (const sessionInfo of [undefined, {}, {authorId: uniqueAuthor()}, {padId: 'myPad'}]) {
      const res = await handleMessage('handleMessage', {
        message: cursorMessage({myAuthorId: 'a.x', padId: 'myPad'}),
        sessionInfo,
      });
      assert.strictEqual(res, null);
    }
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(nameLookups.length, 0);
  });

  it('coerces coordinates to non-negative integers', async function () {
    const authorId = uniqueAuthor();
    await handleMessage('handleMessage', {
      message: cursorMessage({locationX: 4.7, locationY: -5}),
      sessionInfo: {authorId, padId: 'myPad'},
    });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].data.payload.locationX, 4);
    assert.strictEqual(sent[0].data.payload.locationY, 0);
  });

  it('drops non-numeric coordinates', async function () {
    for (const bad of ['1) , div', '2', null, undefined, NaN, Infinity, {}]) {
      await handleMessage('handleMessage', {
        message: cursorMessage({locationY: bad}),
        sessionInfo: {authorId: uniqueAuthor(), padId: 'myPad'},
      });
    }
    assert.strictEqual(sent.length, 0);
  });

  it('ignores unrelated messages', async function () {
    const res = await handleMessage('handleMessage', {
      message: {type: 'COLLABROOM', data: {type: 'USER_CHANGES'}},
      sessionInfo: {authorId: uniqueAuthor(), padId: 'myPad'},
    });
    assert.strictEqual(res, undefined);
    assert.strictEqual(sent.length, 0);
  });
});
