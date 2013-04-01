var initiated = false;
var last = undefined;
var padEditor; 


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
    var inner = $('iframe[name="ace_outer"]').contents().find('iframe');
    var leftOffset = $(inner)[0].offsetLeft;
    var top = $(div).offset().top + 7;

    // The problem we have here is we don't know the px X offset of the caret from the user
    // Because that's a blocker for now lets just put a nice little div on the left hand side..
    // SO here is how we do this..
    // Get the entire string including the styling
    // Put it in a hidden SPAN
    // Delete everything after X chars
    // Measure the new width -- This gives us the offset without modifying the ACE Dom

    // Get the HTML
    var html = $(div).html(); 

    // build an ugly ID, makes sense to use authorId as authorId's cursor can only exist once
    var authorWorker = "hiddenUgly" + exports.getAuthorClassName(authorId); 

    // Get the new string but maintain mark up
    var newText = html_substr(html, (x-1)); 

    // A load of fugly HTML that can prolly be moved ot CSS
    var newLine = "<span style='white-space:pre-wrap;z-index:99999;background:red;position:fixed;top:80px;left:80px;font-size:12px;' id='" + authorWorker + "' class='ghettoCursorXPos'>"+newText+"</span>";

    // Add the HTML to the DOM
    var worker = $('iframe[name="ace_outer"]').contents().find('#outerdocbody').append(newLine);

    // Get the worker element
    var worker = $('iframe[name="ace_outer"]').contents().find('#outerdocbody').find("#" + authorWorker);

    // Get the width of the element (This is how far out X is in px);
    var left = $(worker).width();
    // Add the innerdocbody offset
    left = left + leftOffset;
    // Remove the element
    $('iframe[name="ace_outer"]').contents().find('#outerdocbody').contents().remove("#" + authorWorker);

    // Author color
    var users = pad.collabClient.getConnectedUsers();
    $.each(users, function(user, value){
      if(value.userId == authorId){
        var color = value.colorId; // TODO Watch out for XSS
        var outBody = $('iframe[name="ace_outer"]').contents().find("#outerdocbody");
        var span = $(div).contents().find("span:first");
        var height = $(span).css("line-height");

        // Remove all divs that already exist for this author
        $('iframe[name="ace_outer"]').contents().find(".caret-"+authorClass).remove();

        // Create a new Div for this author
        var $indicator = $("<div class='caretIndicator caret-"+authorClass+"' style='height:"+height+";width:3px;position:absolute;left:"+left+"px;top:"+top +"px;background-color:"+color+"' title="+authorName+"></div>");
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




/***
 * 
 *  Once ace is initialized, we bind the functions to the context
 * 
 ***/

exports.aceInitialized = function(hook, context){
  var editorInfo = context.editorInfo;
//  editorInfo.ace_doInsertTaskList = _(exports.tasklist.doInsertTaskList).bind(context); // What does underscore do here?
//  editorInfo.ace_doToggleTaskListItem = _(exports.tasklist.doToggleTaskListItem).bind(context); // TODO
  padEditor = context.editorInfo.editor;
console.log(padEditor);
}


function html_substr( str, count ) {

    var div = document.createElement('div');
    div.innerHTML = str;

    walk( div, track );

    function track( el ) {
        if( count > 0 ) {
            var len = el.data.length;
            count -= len;
            if( count <= 0 ) {
                el.data = el.substringData( 0, el.data.length + count );
            }
        } else {
            el.data = '';
        }
    }

    function walk( el, fn ) {
        var node = el.firstChild;
        do {
            if( node.nodeType === 3 ) {
                fn(node);
                    //          Added this >>------------------------------------<<
            } else if( node.nodeType === 1 && node.childNodes && node.childNodes[0] ) {
                walk( node, fn );
            }
        } while( node = node.nextSibling );
    }
    return div.innerHTML;
}
