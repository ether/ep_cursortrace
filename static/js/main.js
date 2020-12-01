'use strict';
/*

The ultimate goal of this plugin is to show where a user "is" on a pad.

The logic here is applied in multiple ways.

1. When this user moves their caret, broadcast that change out to the server
2. When another (not this) user moves their caret, receive a message and display
   the location of that users caret.
     * This gets extra tricky due to wrapped lines

*/

// CSS / Styling
exports.aceInitInnerdocbodyHead = (hookName, args, cb) => {
  const cssPath = '../static/plugins/ep_cursortrace/static/css/ace_inner.css';
  args.iframeHTML.push(`<link rel="stylesheet" type="text/css" href="${cssPath}"/>`);
  return cb();
};

// We have to store previous location..  Not ideal but it reduces noise in send
let previousSelection = {};

exports.getAuthorClassName = (author) => {
  if (!author) return false;
  const authorId = author.replace(/[^a-y0-9]/g, (c) => {
    if (c === '.') return '-';
    return `z${c.charCodeAt(0)}z`;
  });
  return `ep_real_time_chat-${authorId}`;
};

exports.className2Author = (className) => {
  if (className.substring(0, 15) === 'ep_cursortrace-') {
    return className.substring(15).replace(/[a-y0-9]+|-|z.+?z/g, (cc) => {
      if (cc === '-') { return '.'; } else if (cc.charAt(0) === 'z') {
        return String.fromCharCode(Number(cc.slice(1, -1)));
      } else {
        return cc;
      }
    });
  }
  return null;
};

exports.handleClientMessage_CUSTOM = (hook, context, cb) => {
  // only handle messages meant for this plugin
  if (context.payload.action !== 'cursorPosition') return cb();
  // don't process our own position...
  // if (pad.getUserId() === context.payload.authorId) return cb();
  // CAKE : Uncomment the above.

  // Let's do a little work to get what we need from the message
  const authorId = context.payload.authorId;
  const authorName = context.payload.authorName;
  const lineNumber = context.payload.locationY;
  const linePosition = context.payload.locationX;
  const authorClass = exports.getAuthorClassName(authorId);

  exports.drawAuthorLocation(authorId, authorName, authorClass, lineNumber, linePosition);
};

exports.drawAuthorLocation = (authorId, authorName, authorClass, lineNumber, linePosition) => {
  console.warn(authorName, authorClass, lineNumber, linePosition);

  const line = $('iframe[name="ace_outer"]').contents().find('iframe').
      contents().find('#innerdocbody').find(`div:nth-child(${lineNumber + 1})`);

  if (line.length === 0) return;

  const $inner = $('iframe[name="ace_outer"]').contents().find('iframe');
  const lineWidth = $(line).width();
  const lineHTML = $(line).html();
  const styles = $(line).getStyleObject();

  const innerPaddingLeft = parseInt($inner.css('padding-left').replace('px', ''));
  const innerWidth = $inner.contents().find('#innerdocbody').width();
  const authorIdNoDot = authorId.replace('.', '');
  const $outerdocbody = $('iframe[name="ace_outer"]').contents().find('#outerdocbody');
  const innerBodyPaddingLeft = parseInt($('iframe[name="ace_outer"]').contents().
      find('iframe').contents().find('body').css('padding-left').replace('px', ''));

  if ($('iframe[name="ace_outer"]').contents().find('#outerdocbody').
      contents('.traceWorkerContainer').length === 0) {
    $outerdocbody.append('<div class="traceWorkerContainer"></div>');
  }
  const $traceWorkerContainer = $outerdocbody.contents('.traceWorkerContainer');
  $traceWorkerContainer.css('width', innerWidth);

  $traceWorkerContainer.css('font-size', '120%'); // TODO: Seba, help!
  // TODO: Items with heading 1 (H1) don't get the right font-size!  Why?!

  // remove the old worker.
  $traceWorkerContainer.contents().remove(`.trace${authorIdNoDot}`);

  // This is horrible but a limitation because I'm parsing HTML
  if ($(lineHTML).children('span').length < 1) linePosition -= 1;

  const newText = html_substr(lineHTML, (linePosition));

  // create a new worker and append it.
  const $hiddenLine = $('<span />', {
    class: `ghettoCursorXPos trace${authorIdNoDot}`,
    width: `${lineWidth}px`,
    html: newText,
    css: styles,
  }).appendTo($traceWorkerContainer);

  // wrap <div>abc</div> up as <div><span>a</span><span>b</span>....
  $($hiddenLine).html(wrap($($hiddenLine)));

  linePosition += 1; // so 0 element becomes 1.

  // If the caret is at the end of the line there will be no span.
  const spanCount = $($hiddenLine).find('span').length;
  if (linePosition === spanCount) {
    // so use the previous position.
    linePosition = spanCount - 1;
  }

  const character = $($hiddenLine).find(`[data-key=${linePosition}]`);

  let left = $('iframe[name="ace_outer"]').contents().find('iframe').offset().left;
  let top = $(line).offset().top; // A standard generic offset

  // adding in top of the ace outer.
  top += parseInt($('iframe[name="ace_outer"]').contents().find('iframe').css('paddingTop'));

  if (character.length !== 0) {
    left += character.position().left;
  }

  const height = $hiddenLine.height(); // the height of the worker
  // plus the top offset minus the actual height of our focus span
  top = top + height - (character.height() || 12);

  $traceWorkerContainer.css('left', `${left + innerPaddingLeft + innerBodyPaddingLeft}px`);
  $traceWorkerContainer.css('top', `${top + 2}px`);
};

/*
exports.handleClientMessage_CUSTOM = function(hook, context, cb){
  // A huge problem with this is that it runs BEFORE the dom has been updated so edit events are always late..

  var action = context.payload.action;
  var padId = context.payload.padId;
  var authorId = context.payload.authorId;
  if(pad.getUserId() === authorId) return false; // Dont process our own caret position (yes we do get it..) -- This is not a bug
  var authorClass = exports.getAuthorClassName(authorId);

  if(action === 'cursorPosition'){ // an author has sent this client a cursor position, we need to show it in the dom

    var authorName = context.payload.authorName;
    if(authorName == "null"){
      var authorName = "😊" // If the users username isn't set then display a smiley face
    }
    var y = context.payload.locationY + 1; // +1 as Etherpad line numbers start at 1
    var x = context.payload.locationX;
    var inner = $('iframe[name="ace_outer"]').contents().find('iframe');
    var innerWidth = inner.contents().find('#innerdocbody').width();
    if(inner.length !== 0){
      var leftOffset = parseInt($(inner).offset().left);
      leftOffset = leftOffset + parseInt($(inner).css('padding-left'));
    }

    var stickUp = false;

    // Get the target Line
    var div = $('iframe[name="ace_outer"]').contents().find('iframe').contents().find('#innerdocbody').find("div:nth-child("+y+")");

    var divWidth = div.width();
    // Is the line visible yet?
    if ( div.length !== 0 ) {
      var top = $(div).offset().top; // A standard generic offset
      // The problem we have here is we don't know the px X offset of the caret from the user
      // Because that's a blocker for now lets just put a nice little div on the left hand side..
      // SO here is how we do this..
      // Get the entire string including the styling
      // Put it in a hidden SPAN that has the same width as ace inner
      // Delete everything after X chars
      // Measure the new width -- This gives us the offset without modifying the ACE Dom
      // Due to IE sucking this doesn't work in IE....

      // We need the offset of the innerdocbody on top too.
      top = top + parseInt($('iframe[name="ace_outer"]').contents().find('iframe').css('paddingTop'));

      // Get the HTML
      var html = $(div).html();

      // build an ugly ID, makes sense to use authorId as authorId's cursor can only exist once
      var authorWorker = "hiddenUgly" + exports.getAuthorClassName(authorId);

      // if Div contains block attribute IE h1 or H2 then increment by the number
      if ( $(div).children("span").length < 1 ){ x = x - 1; }// This is horrible but a limitation because I'm parsing HTML

      // Get the new string but maintain mark up
      var newText = html_substr(html, (x));

      // A load of ugly HTML that can prolly be moved to CSS
      var newLine = "<span style='width:"+divWidth+"px' id='" + authorWorker + "' class='ghettoCursorXPos'>"+newText+"</span>";

      // Add the HTML to the DOM
      $('iframe[name="ace_outer"]').contents().find('#outerdocbody').append(newLine);

      // Get the worker element
      var worker = $('iframe[name="ace_outer"]').contents().find('#outerdocbody').find("#" + authorWorker);

      // Wrap the HTML in spans so we can find a char
      $(worker).html(wrap($(worker)));
      // console.log($(worker).html(), x);

      // Get the Left offset of the x span
      var span = $(worker).find("[data-key="+(x-1)+"]");

      // Get the width of the element (This is how far out X is in px);
      if(span.length !== 0){
        var left = span.position().left;
      }else{
        // empty span.
        var left = 0;
      }

      // Get the height of the element minus the inner line height
      var height = worker.height(); // the height of the worker
      top = top + height - (span.height() || 12); // plus the top offset minus the actual height of our focus span
      if(top <= 0){  // If the tooltip wont be visible to the user because it's too high up
        stickUp = true;
        top = top + (span.height()*2);
        if(top < 0){ top = 0; } // handle case where caret is in 0,0
      }

      // Add the innerdocbody offset
      left = left + leftOffset;

      // Add support for page view margins
      var divMargin = $(div).css("margin-left");
      var innerdocbodyMargin = $(div).parent().css("padding-left");
      if(innerdocbodyMargin){
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
      left = left+18;

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

          // Create a new Div for this author
          var $indicator = $("<div class='caretindicator "+ location+ " caret-"+authorClass+"' style='height:16px;left:"+left+"px;top:"+top +"px;background-color:"+color+"'><p class='stickp "+location+"'></p></div>");
          $indicator.attr("title", authorName);
          $indicator.find("p").text(authorName);
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
  return cb();
}
*/
const wrap = (target) => {
  const newtarget = $('<div></div>');
  const nodes = target.contents().clone(); // the clone is critical!
  let spanKey = 0;
  nodes.each(function () {
    if (this.nodeType === 3) { // text
      let newhtml = '';
      const text = this.wholeText; // maybe "textContent" is better?
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') {
          newhtml += `<span data-key="${spanKey}"> </span>`;
        } else {
          newhtml += `<span data-key=${spanKey}>${text[i]}</span>`;
        }
        spanKey++;
      }
      newtarget.append($(newhtml));
    } else { // recursion FTW!
      $(this).html(wrap($(this))); // This really hurts doing any sort of count..
      newtarget.append($(this));
    }
  });
  return newtarget.html();
};

exports.aceEditEvent = (hookName, args, cb) => {
  // This seems counter-intuitive but actually idleWorkTimer is the only
  // thing that keeps an accurate rep selection..  It's crazy I know..
  if (args.callstack.type !== 'idleWorkTimer') return cb();

  // Get the actual rep, because we don't trust the callstack.
  const rep = args.editorInfo.ace_getRep();

  const currentSelection = {
    selStart: rep.selStart,
    selEnd: rep.selEnd,
  };

  // has our position changed?
  if (JSON.stringify(currentSelection) === JSON.stringify(previousSelection)) return cb();

  // Update the prevoius selection :)
  previousSelection = currentSelection;

  // Create a cursor position message to send to the server
  const message = {
    type: 'cursor',
    action: 'cursorPosition',
    locationY: args.rep.selStart[0],
    locationX: args.rep.selStart[1],
    padId: pad.getPadId(),
    myAuthorId: pad.getUserId(),
  };

  // Send the cursor position message to the server
  pad.collabClient.sendMessage(message);
  cb();
};

/*
 * getStyleObject Plugin for jQuery JavaScript Library
 * From: http://upshots.org/?p=112
 * Refactored for this Etherpad plugin
 */

(function ($) {
  $.fn.getStyleObject = function () {
    const dom = this.get(0);
    let style;
    const returns = {};
    if (window.getComputedStyle) {
      const camelize = (a, b) => b.toUpperCase();
      style = window.getComputedStyle(dom, null);
      for (let i = 0, l = style.length; i < l; i++) {
        const prop = style[i];
        const camel = prop.replace(/-([a-z])/g, camelize);
        const val = style.getPropertyValue(prop);
        returns[camel] = val;
      }
      return returns;
    }
    if (style === dom.currentStyle) {
      for (const prop in style) {
        if (style[prop]) {
          returns[prop] = style[prop];
        }
      }
      return returns;
    }
    return this.css();
  };
})(jQuery);

const html_substr = (str, count) => {
  const div = document.createElement('div');
  div.innerHTML = str;

  const track = (el) => {
    if (count > 0) {
      const len = el.data.length;
      count -= len;
      if (count <= 0) {
        el.data = el.substringData(0, el.data.length + count);
      }
    } else {
      el.data = '';
    }
  };

  const walk = (el, fn) => {
    let node = el.firstChild;
    if (!node) return;
    do {
      if (node.nodeType === 3) {
        fn(node);
      } else if (node.nodeType === 1 && node.childNodes && node.childNodes[0]) {
        walk(node, fn);
      }
    } while (node = node.nextSibling); // TODO WTF!
  };

  walk(div, track);
  return div.innerHTML;
};
