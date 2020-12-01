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

  exports.discoverAuthorLocation(authorId, authorName, authorClass, lineNumber, linePosition);
};

exports.discoverAuthorLocation = (authorId, authorName, authorClass, lineNumber, linePosition) => {
  // TODO: Need Rhansen help to remove :D
  let spanKey = 0; // This global is required for the wrap function to work properly

  // console.warn(authorName, authorClass, lineNumber, linePosition);

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
  // TODO: Investigate if the below line is relevant any more?
  // if ($(lineHTML).children('span').length < 1) linePosition -= 1;

  const newText = htmlSubstr(lineHTML, (linePosition));

  // create a new worker and append it.
  const $hiddenLine = $('<span />', {
    class: `ghettoCursorXPos trace${authorIdNoDot}`,
    width: `${lineWidth}px`,
    html: newText,
    css: styles,
  }).appendTo($traceWorkerContainer);

  // wrap <div>abc</div> up as <div><span>a</span><span>b</span>....
  console.warn("before", spanKey)
  const wrapped = wrap($hiddenLine, spanKey);
  console.warn("wrapped", wrapped)
  $($hiddenLine).html(wrapped.html);
  spanKey = wrapped.spanKey;
  // linePosition += 1; // so 0 element becomes 1.

  // If the caret is at the end of the line there will be no span.
  const spanCount = $($hiddenLine).find('span').length;
  if (linePosition === spanCount) {
    // so use the previous position.
    linePosition = spanCount - 1;
  }

  console.warn($hiddenLine.contents().find('span'));
        // var span = $(worker).find("[data-key="+(x-1)+"]");
  const character = $hiddenLine.contents().find("[data-key="+linePosition+"]");
console.warn(character);
    console.warn(character.html());
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

console.warn("left", left)

  drawAuthorLocation(top, left, authorId, authorIdNoDot, authorName);
};

const drawAuthorLocation = (top, left, authorId, authorIdNoDot, authorName) => {
  // Author color
  const users = pad.collabClient.getConnectedUsers();
  $.each(users, (user, value) => {
    if (value.userId === authorId) {
      const colors = pad.getColorPalette(); // support non set colors
      let color;
      if (colors[value.colorId]) {
        color = colors[value.colorId];
      } else {
        color = value.colorId; // Test for XSS
      }
      const outBody = $('iframe[name="ace_outer"]').contents().find('#outerdocbody');

      // Remove all divs that already exist for this author
      $('iframe[name="ace_outer"]').contents().find(`.caret-${authorIdNoDot}`).remove();
console.warn("left2", left);
      // Create a new Div for this author
      const $indicator =
       $(`<div class='caretindicator ${location} caret-${authorIdNoDot}' \
       style='height:16px;left:${left}px;top:${top}px;background-color:${color}'> \
       <p class='stickp ${location}'></p></div>`);
      $indicator.attr('title', authorName);
      $indicator.find('p').text(authorName);
      $(outBody).append($indicator);

      // After a while, fade it out :)
      setTimeout(() => {
        $indicator.fadeOut(500, () => {
          $indicator.remove();
        });
      }, 2000);
    }
  });
};


const wrap = (target, spanKey) => {
  console.warn("in wrap", spanKey)
  const newtarget = $('<div></div>');
  const nodes = target.contents().clone(); // the clone is critical!
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
        console.warn("spanKey", spanKey) // Gah spanKey is doing weird stuff
        // need help from @rhansen again :D
      }
      newtarget.append($(newhtml));
    } else { // recursion FTW!
      $(this).html(wrap($(this), spanKey)); // This really hurts doing any sort of count..
      newtarget.append($(this));
    }
  });
  return {
    html: newtarget.html(),
    spanKey,
  }
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

const htmlSubstr = (str, count) => {
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
    } while (node = node.nextSibling); // recursion, what's the best thing to do here?!
    // TODO: Need rhansen help.
  };

  walk(div, track);
  return div.innerHTML;
};
