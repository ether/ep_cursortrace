/***
*
* Responsible for negotiating messages between two clients
*
****/

var authorManager = require("ep_etherpad-lite/node/db/AuthorManager"),
padMessageHandler = require("ep_etherpad-lite/node/handler/PadMessageHandler"),
            async = require('ep_etherpad-lite/node_modules/async');

var buffer = {};

/* 
* Handle incoming messages from clients
*/
exports.handleMessage = function(hook_name, context, callback){
  // Firstly ignore any request that aren't about cursor
  var iscursorMessage = false;
  if(context){
    if(context.message && context.message){
      if(context.message.type === 'COLLABROOM'){
        if(context.message.data){ 
          if(context.message.data.type){
            if(context.message.data.type === 'cursor'){
              iscursorMessage = true;
            } 
          }
        }
      }
    }
  }
  if(!iscursorMessage){
    callback(false);
    return false;
  }

  var message = context.message.data;
  /***
    What's available in a message?
     * action -- The action IE cursorPosition
     * padId -- The padId of the pad both authors are on
     * targetAuthorId -- The Id of the author this user wants to talk to
     * locationX and location Y are the locations. // TODO make this one object or a touple
     * myAuthorId -- The Id of the author who is trying to talk to the targetAuthorId
  ***/
  if(message.action === 'cursorPosition'){
    authorManager.getAuthorName(message.myAuthorId, function(er, authorName){ // Get the authorname

      var msg = {
        type: "COLLABROOM",
        data: { 
          type: "CUSTOM",
          payload: {
            action: "cursorPosition",
            authorId: message.myAuthorId,
            authorName: authorName,
            padId: message.padId,
            locationX: message.locationX,
            locationY: message.locationY
          }
        }
      };
      sendToRoom(message, msg);
    });
  }

  if(iscursorMessage === true){
    callback([null]);
  }else{
    callback(true);
  }
}


function sendToRoom(message, msg){
  var bufferAllows = true; // Todo write some buffer handling for protection and to stop DDoS -- myAuthorId exists in message.
  if(bufferAllows){
    setTimeout(function(){ // This is bad..  We have to do it because ACE hasn't redrawn by the time the cursor has arrived
      padMessageHandler.handleCustomObjectMessage(msg, false, function(){
        // TODO: Error handling.
      })
    }
    , 500);
  }
}
