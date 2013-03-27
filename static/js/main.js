var initiated = false;
var last = undefined;

exports.aceInitInnerdocbodyHead = function(hook_name, args, cb) {
  // FIXME: relative paths
  args.iframeHTML.push('<link rel="stylesheet" type="text/css" href="/static/plugins/ep_cursortrace/static/css/ace_inner.css"/>');
  return cb();
};

exports.postAceInit = function(hook_name, args, cb) {
  initiated = true;
};


exports.getAuthorClassName = function(author)
{
  return "ep_cursortrace-" + author.replace(/[^a-y0-9]/g, function(c)
  {
    if (c == ".") return "-";
    return 'z' + c.charCodeAt(0) + 'z';
  });
}

exports.className2Author = function(className)
{
  if (className.substring(0, 15) == "ep_cursortrace-")
  {
    return className.substring(15).replace(/[a-y0-9]+|-|z.+?z/g, function(cc)
    {
      if (cc == '-') return '.';
      else if (cc.charAt(0) == 'z')
      {
        return String.fromCharCode(Number(cc.slice(1, -1)));
      }
      else
      {
        return cc;
      }
    });
  }
  return null;
}

var lineAndColumnFromChar = function(x)
{
  var lineEntry = rep.lines.atOffset(x);
  var lineStart = rep.lines.offsetOfEntry(lineEntry);
  var lineNum = rep.lines.indexOfEntry(lineEntry);
  return [lineNum, x - lineStart];
}

exports.aceEditEvent = function(hook_name, args, cb) {
  // Note: last is a tri-state: undefined (when the pad is first loaded), null (no last cursor) and [line, col]
  if (initiated && args.callstack.isUserChange && args.callstack.selectionAffected && !(args.callstack.editEvent.eventType === "idleWorkTimer") && args.callstack.docTextChanged && (args.callstack.type === "handleKeyEvent") ) {
    var rep = args.editorInfo.ace_getRep();
    if (!last || rep.selEnd[0] != last[0] || rep.selEnd[1] != last[1]) {
      var cls = exports.getAuthorClassName(args.editorInfo.ace_getAuthor());
      var myAuthorId = pad.getUserId();
      var padId = pad.getPadId();
      var location = {y: rep.selEnd[0], x: rep.selEnd[1]};
      // Create a REQUEST message to send to the server
      var message = {
        type : 'cursor',
        action : 'cursorPosition',
        locationY: rep.selEnd[0],
        locationX: rep.selEnd[1],
        padId : padId,
        myAuthorId : myAuthorId
      }
      console.log("Sent message", message);
      pad.collabClient.sendMessage(message);  // Send the request through the server to create a tunnel to the client


/*
      if (last) {
         console.log("X1");
        args.editorInfo.ace_performDocumentApplyAttributesToRange([last[0], Math.max(last[1] - 1, 0)], last, [[cls, ""]]);
      } else if (last != undefined) {
        console.log("X2");
        args.editorInfo.ace_performDocumentApplyAttributesToCharRange(0, rep.alltext.length, [[cls, ""]]);
      }

      var line = rep.lines.atIndex(rep.selEnd[0]);
      if (line.width > 0) {
        console.log("X3");
        args.editorInfo.ace_performDocumentApplyAttributesToRange([rep.selEnd[0], Math.max(rep.selEnd[1] - 1, 0)], rep.selEnd, [[cls, "true"]]);
        last = rep.selEnd;
      } else {
        last = null;
      }
*/
    }

  }
}

exports.handleClientMessage_CUSTOM = function(hook, context, wut){
  var action = context.payload.action;
  var padId = context.payload.padId;
  var myAuthorId = context.payload.authorId;

  if(pad.getUserId() === myAuthorId) return false; // Dont process our own caret position (yes we do get it..)

  if(action === 'cursorPosition'){ // someone has requested we approve their rtc request - we recieved an offer
    
    var authorName = escape(context.payload.authorName);
    console.log("new position from "+authorName, context.payload);
  }
}

exports.aceAttribsToClasses = function(hook_name, args, cb) {
  if (args.key.indexOf('ep_cursortrace-') != -1 && args.value != "") {
    return cb([args.key]);
  }
  cb();
};

exports.aceCreateDomLine = function(hook_name, args, cb) {
  if (args.cls.indexOf('ep_cursortrace-') >= 0) {
    var clss = [];
    var argClss = args.cls.split(" ");
    var authorId = null;
    var authorObj = null;

    for (var i = 0; i < argClss.length; i++) {
      var cls = argClss[i];
      if (cls.indexOf('ep_cursortrace-')==0){
        authorId = exports.className2Author(cls);
        authorObj = clientVars.collab_client_vars.historicalAuthorData[authorId];
      } else {
        clss.push(cls);
      }
    }

    if (!authorObj) {
      return cb([{cls: clss.join(" "), extraOpenTags: '', extraCloseTags: ''}]);
    }

    var color = authorObj.colorId;
    if (typeof(color) == "number") {
      color = clientVars.colorPalette[color];
    }

    return cb([{cls: clss.join(" "), extraOpenTags: '<span style="border-bottom: 5px solid ' + color +'">', extraCloseTags: '</span>'}]);
  }
};
