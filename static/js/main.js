var initiated = false;
var last = undefined;

exports.aceInitInnerdocbodyHead = function(hook_name, args, cb) {
  // FIXME: relative paths
  args.iframeHTML.push('<link rel="stylesheet" type="text/css" href="../static/plugins/ep_cursortrace/static/css/ace_inner.css"/>');
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
  // TODO: Click events show previous position :|  Seems to be a race condition
  var caretMoving = ((!args.callstack.editEvent.eventType == "handleClick") || (args.callstack.type === "handleKeyEvent"));
  if (caretMoving && initiated && !(args.callstack.editEvent.eventType === "idleWorkTimer")){
    var rep = args.editorInfo.ace_getRep(); // get the caret position
    var Y = rep.selEnd[0];
    var X = rep.selEnd[1];
    if (!last || Y != last[0] || X != last[1]) { // If the position has changed
      var cls = exports.getAuthorClassName(args.editorInfo.ace_getAuthor());
      var myAuthorId = pad.getUserId();
      var padId = pad.getPadId();
      var location = {y: Y, x: X};
      // Create a REQUEST message to send to the server
      var message = {
        type : 'cursor',
        action : 'cursorPosition',
        locationY: Y,
        locationX: X,
        padId : padId,
        myAuthorId : myAuthorId
      }
      last = [];
      last[0] = Y;
      last[1] = X;
      
      // console.log("Sent message", message);
      pad.collabClient.sendMessage(message);  // Send the request through the server to create a tunnel to the client
    }
  }
}

exports.handleClientMessage_CUSTOM = function(hook, context, wut){
  var action = context.payload.action;
  var padId = context.payload.padId;
  var authorId = context.payload.authorId;
  if(pad.getUserId() === authorId) return false; // Dont process our own caret position (yes we do get it..)
  var authorClass = exports.getAuthorClassName(authorId);

  if(action === 'cursorPosition'){ // someone has requested we approve their rtc request - we recieved an offer
    
    var authorName = escape(context.payload.authorName);
    var y = context.payload.locationY;
    var x = context.payload.locationX;
    y = y+1; // Etherpad line numbers start at 1
    var div = $('iframe[name="ace_outer"]').contents().find('iframe').contents().find('#innerdocbody').find("div:nth-child("+y+")");
    var top = $(div).offset().top;
    top = top+8;
    var html = $(div).html();
    var text = $(div).text();
    // The problem we have here is we don't know the px X offset of the caret from the user
    // Because that's a blocker for now lets just put a nice little div on the left hand side..
    // Author color
    var users = pad.collabClient.getConnectedUsers();
    $.each(users, function(user, value){
      if(value.userId == authorId){
        var color = value.colorId; // TODO Watch out for XSS
        var outBody = $('iframe[name="ace_outer"]').contents().find("body");
        var height = $(div).height();

        // Remove all divs that already exist for this author
        $('iframe[name="ace_outer"]').contents().find(".caret-"+authorClass).remove();

        // Create a new Div for this author
        var $indicator = $("<div class='caretIndicator caret-"+authorClass+"' style='height:"+height+"px;width:3px;position:absolute;left:24px;top:"+top +"px;background-color:"+color+"' title="+authorName+"></div>");
        $(outBody).append($indicator);
  
        // After a while, fade it out :)
        setTimeout(function(){
          $indicator.fadeOut(500, function(){
            $indicator.remove();
          });
        }, 2000);
      }
    });     

  }
}
/*
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

*/

