var initiated = false;
var last = undefined;
var padEditor; 
var globalKey = 0;

exports.aceInitInnerdocbodyHead = function(hook_name, args, cb) {
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
  // The AceEditEvent because it usually applies to selected items and isn't really so mucha bout current position.
  var caretMoving = ((args.callstack.editEvent.eventType == "handleClick") || (args.callstack.type === "handleKeyEvent") || (args.callstack.type === "idleWorkTimer") );
  if (caretMoving && initiated){ // Note that we have to use idle timer to get the mouse position
    var Y = args.rep.selStart[0];
    var X = args.rep.selStart[1];
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

exports.handleClientMessage_CUSTOM = function(hook, context, cb){
  /* I NEED A REFACTOR, please */

  // A huge problem with this is that it runs BEFORE the dom has been updated so edit events are always late..

  var action = context.payload.action;
  var padId = context.payload.padId;
  var authorId = context.payload.authorId;
  if(pad.getUserId() === authorId) return false; // Dont process our own caret position (yes we do get it..)
  var authorClass = exports.getAuthorClassName(authorId);

  if(action === 'cursorPosition'){ // someone has requested we approve their rtc request - we recieved an offer

    var authorName = decodeURI(escape(context.payload.authorName));
    if(authorName == "null"){
      var authorName = "&#9785;" // If the users username isn't set then display a smiley face
    }
    var y = context.payload.locationY + 1; // +1 as Etherpad line numbers start at 1
    var x = context.payload.locationX;
    var inner = $('iframe[name="ace_outer"]').contents().find('iframe');
    var innerWidth = inner.contents().find('#innerdocbody').width();
    var leftOffset = $(inner)[0].offsetLeft +3;
    var stickUp = false;
    var stickLeft = true;

    // Get the target Line
    var div = $('iframe[name="ace_outer"]').contents().find('iframe').contents().find('#innerdocbody').find("div:nth-child("+y+")");

    // Is the line visible yet?
    if ( div.length !== 0 ) {
      var top = $(div).offset().top -10; // A standard generic offset
      // The problem we have here is we don't know the px X offset of the caret from the user
      // Because that's a blocker for now lets just put a nice little div on the left hand side..
      // SO here is how we do this..
      // Get the entire string including the styling
      // Put it in a hidden SPAN that has the same width as ace inner
      // Delete everything after X chars
      // Measure the new width -- This gives us the offset without modifying the ACE Dom

      // Get the HTML
      var html = $(div).html(); 

      // build an ugly ID, makes sense to use authorId as authorId's cursor can only exist once
      var authorWorker = "hiddenUgly" + exports.getAuthorClassName(authorId); 

      // if Div contains block attribute IE h1 or H2 then increment by the number
      if ( $(div).children("span").length < 1 ){ x = x - 1; }// This is horrible but a limitation because I'm parsing HTML

      // Get the new string but maintain mark up
      var newText = html_substr(html, (x)); 

      // A load of fugly HTML that can prolly be moved ot CSS
      var newLine = "<span id='" + authorWorker + "' class='ghettoCursorXPos'>"+newText+"</span>";

      // Set the globalKey to 0, we use this when we wrap the objects in a datakey
      globalKey = 0; // It's bad, messy, don't ever develop like this.

      // Add the HTML to the DOM
      var worker = $('iframe[name="ace_outer"]').contents().find('#outerdocbody').append(newLine);

      // Get the worker element
      var worker = $('iframe[name="ace_outer"]').contents().find('#outerdocbody').find("#" + authorWorker);

      // Wrap teh HTML in spans so we cna find a char
      $(worker).html(wrap($(worker), true));
      // console.log($(worker).html(), x);

      // Get the Left offset of the x span
      var span = $(worker).find("[data-key="+(x-1)+"]");

      // Get the width of the element (This is how far out X is in px);
      if(span.length !== 0){
        var left = span.position().left;
        left = left + span.width(); // Remember the span here is the stealth span not teh parent span
      }else{
        var left = $(worker).width();
      }
      // This gives us our X offset :)
      
      if(top < 0){  // If the tooltip wont be visible to the user because it's too high up
        var height = $(div).height() +6;
        stickUp = true;
        top = height;
      }else{
        // Get the height of the element
        // var height = $(worker).height();
        // top = top + height;
      }
      

      // Add the innerdocbody offset
      left = left + leftOffset;

      // Remove the element
      $('iframe[name="ace_outer"]').contents().find('#outerdocbody').contents().remove("#" + authorWorker);

      // Author color
      var users = pad.collabClient.getConnectedUsers();
      $.each(users, function(user, value){
        if(value.userId == authorId){
          var colors = pad.getColorPalette(); // support non set colors
          if(colors[value.colorId]){
            var color = colors[value.colorId];
          }else{
            var color = value.colorId; // Test for XSS
          }
          var outBody = $('iframe[name="ace_outer"]').contents().find("#outerdocbody");
          var span = $(div).contents().find("span:first");
  
          // Remove all divs that already exist for this author
          $('iframe[name="ace_outer"]').contents().find(".caret-"+authorClass).remove();
  
          // Location of stick direction IE up or down
          if(stickUp){var location = 'stickUp';}else{var location = 'stickDown';}
  
          // Location of stick direction IE up or down
          if(stickLeft){var locationLR = 'stickLeft';}else{var locationLR = 'stickRight';}
  
          // Create a new Div for this author
          var $indicator = $("<div class='caretindicator "+ location+ " caret-"+authorClass+"' style='height:16px;left:"+left+"px;top:"+top +"px;background-color:"+color+"' title="+authorName+"><p class='"+location+"'>"+authorName+"</p></div>");
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
}




/***
 * 
 *  Once ace is initialized, we bind the functions to the context
 * 
 ***/

exports.aceInitialized = function(hook, context){
  var editorInfo = context.editorInfo;
  padEditor = context.editorInfo.editor;
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

function wrap(target, key) { // key can probably be removed here..
    var newtarget = $("<div></div>");
    nodes = target.contents().clone(); // the clone is critical!
    if(key === true){ // We can probably remove all of thise..
      var key = 0; // Key allows us to increemnt an index inside recursion
    }
    nodes.each(function() {
        if (this.nodeType == 3) { // text
            var newhtml = "";
            var text = this.wholeText; // maybe "textContent" is better?
            for (var i=0; i < text.length; i++) {
                if (text[i] == ' '){
                  newhtml += "<span data-key="+globalKey+"> </span>";
                }
                else
                { 
                  newhtml += "<span data-key="+globalKey+">" + text[i] + "</span>";
                }
                key++;
                globalKey++;
            }
            newtarget.append($(newhtml));
        }
        else { // recursion FTW!
            $(this).html(wrap($(this), key)); // This really hurts doing any sort of count..
            newtarget.append($(this));
        }
    });
    return newtarget.html();
}
