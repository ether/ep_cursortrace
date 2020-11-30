'use strict';

/** *
*
* Responsible for negotiating messages between two clients
*
****/

const authorManager = require('ep_etherpad-lite/node/db/AuthorManager');
const padMessageHandler = require('ep_etherpad-lite/node/handler/PadMessageHandler');

/*
* Handle incoming messages from clients
*/
exports.handleMessage = async (hookName, context) => {
  // Firstly ignore any request that aren't about cursor
  const {message: {type, data = {}} = {}} = context || {};
  if (type !== 'COLLABROOM' || data.type !== 'cursor') return;

  const message = data;
  /** *
    What's available in a message?
     * action -- The action IE cursorPosition
     * padId -- The padId of the pad both authors are on
     * targetAuthorId -- The Id of the author this user wants to talk to
     * locationX and location Y are the locations. // TODO make this one object or a touple
     * myAuthorId -- The Id of the author who is trying to talk to the targetAuthorId
  ***/
  if (message.action === 'cursorPosition') {
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
    sendToRoom(message, msg);
  }

  return null; // null prevents Etherpad from attempting to process the message any further.
};


const sendToRoom = (message, msg) => {
  // Todo write some buffer handling for protection and to stop DDoS
  // myAuthorId exists in message.
  const bufferAllows = true;
  if (bufferAllows) {
    // We have to do this because the editor hasn't redrawn by the time the cursor has arrived
    setTimeout(() => {
      padMessageHandler.handleCustomObjectMessage(msg, false, () => {
        // TODO: Error handling.
      });
    }
    , 500);
  }
};
