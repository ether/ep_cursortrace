var initiated = false;
var last = undefined;
var padEditor; 
var globalKey = 0;
var isFollowing = false;

exports.documentReady = function(){
  // Set the title
  $('body').on('mouseover', '#otheruserstable > tbody > tr > td > div', function(){
    $(this).css("cursor", "pointer");
    $(this).attr("title", "Watch this author");
  });
  // Watch / follow a user
  $('body').on('click', '#otheruserstable > tbody > tr > td > div', function(){
    // already watching so stop watching
    if($(this).hasClass("buttonicon-clearauthorship")){
      $(this).removeClass("buttonicon buttonicon-clearauthorship");
      isFollowing = false;
    }else{
      isFollowing = $(this).parent().parent().data("authorid");
      $(this).addClass("buttonicon buttonicon-clearauthorship");
      $(this).css({"font-size":"12px","color":"#666"});
    }
    //  watchUser.toggle();
  });
}

exports.aceInitInnerdocbodyHead = function(hook_name, args, cb) {
  args.iframeHTML.push('<link rel="stylesheet" type="text/css" href="../static/plugins/ep_cursortrace/static/css/ace_inner.css"/>');
  return cb();
};

exports.postAceInit = function(hook_name, args, cb) {
  initiated = true;
};

exports.getAuthorClassName = function(author)
{
  if(!author) return;
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
      // Create a cursor position message to send to the server
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
      pad.collabClient.sendMessage(message);  // Send the cursor position message to the server
    }
  }
}

exports.handleClientMessage_CUSTOM = function(hook, context, cb){
  /* I NEED A REFACTOR, please */
  // A huge problem with this is that it runs BEFORE the dom has been updated so edit events are always late..

  var action = context.payload.action;
  var padId = context.payload.padId;
  var authorId = context.payload.authorId;
  if(pad.getUserId() === authorId) return false; // Dont process our own caret position (yes we do get it..) -- This is not a bug
  var authorClass = exports.getAuthorClassName(authorId);

  if(action === 'cursorPosition'){ // an author has sent this client a cursor position, we need to show it in the dom

    var authorName = decodeURI(escape(context.payload.authorName));
    if(authorName == "null"){
      var authorName = "&#9785;" // If the users username isn't set then display a smiley face
    }
    var y = context.payload.locationY + 1; // +1 as Etherpad line numbers start at 1
    var x = context.payload.locationX;
    var inner = $('iframe[name="ace_outer"]').contents().find('iframe');
    var innerWidth = inner.contents().find('#innerdocbody').width();
    // it appears on apple devices this might not be set properly?
    if($(inner)[0]){
      var leftOffset = $(inner)[0].offsetLeft +3;
    }else{
      var leftOffset = 0;
    }
    var stickUp = false;
    var stickLeft = true;

    // Get the target Line
    var div = $('iframe[name="ace_outer"]').contents().find('iframe').contents().find('#innerdocbody').find("div:nth-child("+y+")");
    var divWidth = div.width();

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
      // Due to IE sucking this doesn't work in IE....

      // Get the HTML
      var html = $(div).html(); 

      // build an ugly ID, makes sense to use authorId as authorId's cursor can only exist once
      var authorWorker = "hiddenUgly" + exports.getAuthorClassName(authorId); 

      // if Div contains block attribute IE h1 or H2 then increment by the number
      if ( $(div).children("span").length < 1 ){ x = x - 1; }// This is horrible but a limitation because I'm parsing HTML

      // Get the new string but maintain mark up
      var newText = html_substr(html, (x)); 

      // A load of fugly HTML that can prolly be moved ot CSS
      var newLine = "<span style='width:"+divWidth+"px' id='" + authorWorker + "' class='ghettoCursorXPos'>"+newText+"</span>";

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
      }else{
        var left = 0;
      }

      // Get the height of the element minus the inner line height
      var height = worker.height(); // the height of the worker
      top = top + height - span.height(); // plus the top offset minus the actual height of our focus span
      if(top <= 0){  // If the tooltip wont be visible to the user because it's too high up
        stickUp = true;
        top = top + (span.height()*2);
        if(top < 0){ top = 0; } // handle case where caret is in 0,0
      }

      // Add the innerdocbody offset
      left = left + leftOffset;

      // Add support for page view margins
      var divMargin = $(div).css("margin-left");
      var innerdocbodyMargin = $(div).parent().css("margin-left"); 
      if(innerdocbodyMargin){
        innerdocbodyMargin = innerdocbodyMargin.replace("px", "");
        innerdocbodyMargin = parseInt(innerdocbodyMargin);
      }else{
        innerdocbodyMargin = 0;
      }
      if(divMargin){
        divMargin = divMargin.replace("px", "");
        // console.log("Margin is ", divMargin);
        divMargin = parseInt(divMargin);
        if((divMargin + innerdocbodyMargin) > 0){
          // console.log("divMargin", divMargin);
          left = left + divMargin;
        }
      }

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

          // Are we following this author?
          if(isFollowing && isFollowing === value.userId){

            // scroll to the authors location
            var $inner = $('iframe[name="ace_outer"]').contents().find("#outerdocbody");
            if(top < 30) top = 0; // top line needs to be left visible
            var newY = top + "px";
            var $outerdoc = $('iframe[name="ace_outer"]').contents().find("#outerdocbody");
            var $outerdocHTML = $('iframe[name="ace_outer"]').contents().find("#outerdocbody").parent();
            $outerdoc.animate({scrollTop: newY});
            if(browser.firefox) $outerdocHTML.animate({scrollTop: newY}); // needed for FF

          }
  
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
  if( browser.msie ) return ""; // IE can't handle processing any of the X position stuff so just return a blank string
  // Basically the recursion makes IE run out of memory and slows a pad right down, I guess a way to fix this would be to
  // only wrap the target / last span or something or stop it destroying and recreating on each change..  
  // Also IE can often inherit the wrong font face IE bold but not apply that to the whole document ergo getting teh width wrong
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
    if(!node) return;
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
      // console.log("recursion"); // IE handles recursion badly
      $(this).html(wrap($(this), key)); // This really hurts doing any sort of count..
      newtarget.append($(this));
    }
  });
  return newtarget.html();
}
