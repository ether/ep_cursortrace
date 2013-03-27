/***
*
* Responsible for negotiating messages between two clients
*
****/

var authorManager = require("../../src/node/db/AuthorManager"),
padMessageHandler = require("../../src/node/handler/PadMessageHandler"),
            async = require('../../src/node_modules/async');

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
            padId: message.padId
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
//  var sessions = padMessageHandler.sessioninfos;
// TODO: Optimize me
//  Object.keys(sessions).forEach(function(key){
//    var session = sessions[key]
//    if(session.author == message.targetAuthorId){
  padMessageHandler.handleCustomObjectMessage(msg, false, function(){
      // TODO: Error handling
//      }); // Send a message to this session
//    }
  });
}
