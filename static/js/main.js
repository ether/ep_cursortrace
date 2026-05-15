'use strict';

let initiated = false;
let last = undefined;

const {padToggle} = require('ep_plugin_helpers/pad-toggle');
const {createThrottle} = require('./throttle');
const toggleConfig = require('../../toggle-config');

const THROTTLE_MS = 250;
let cursorThrottle = null;
let cursortraceEnabled = toggleConfig.defaultEnabled;

const cursortraceToggle = padToggle(toggleConfig);

const sendCursor = (message) => {
  pad.collabClient.sendMessage(message);
};

const clearRemoteCarets = () => {
  $('iframe[name="ace_outer"]').contents().find('.caretindicator').remove();
};

const setCursortraceEnabled = (enabled) => {
  cursortraceEnabled = !!enabled;
  last = undefined;
  if (!cursortraceEnabled) clearRemoteCarets();
};

exports.aceInitInnerdocbodyHead = (hookName, args, cb) => {
  const url = '../static/plugins/ep_cursortrace/static/css/ace_inner.css';
  args.iframeHTML.push(`<link rel="stylesheet" type="text/css" href="${url}"/>`);
  cb();
};

exports.postAceInit = (hookName, args, cb) => {
  initiated = true;
  cursortraceToggle.init({onChange: setCursortraceEnabled});
  window.addEventListener('beforeunload', () => {
    if (cursorThrottle) cursorThrottle.flush();
  });
  cb();
};

exports.handleClientMessage_CLIENT_MESSAGE = cursortraceToggle.handleClientMessage_CLIENT_MESSAGE;

exports.getAuthorClassName = (author) => {
  if (!author) return false;
  const authorId = author.replace(/[^a-y0-9]/g, (c) => {
    if (c === '.') return '-';
    return `z${c.charCodeAt(0)}z`;
  });
  return `ep_real_time_chat-${authorId}`;
};

exports.className2Author = (className) => {
  if (className.substring(0, 7) === 'author-') {
    return className.substring(7).replace(/[a-y0-9]+|-|z.+?z/g, (cc) => {
      if (cc === '-') { return '.'; } else if (cc.charAt(0) === 'z') {
        return String.fromCharCode(Number(cc.slice(1, -1)));
      } else {
        return cc;
      }
    });
  }
};

const getTextPoint = (line, offset) => {
  const doc = line.ownerDocument;
  const walker = doc.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let lastTextNode = null;
  let totalLength = 0;
  let node;
  while ((node = walker.nextNode())) {
    lastTextNode = node;
    const len = node.textContent.length;
    totalLength += len;
    if (remaining <= len) return {node, offset: remaining, clamped: false, totalLength};
    remaining -= len;
  }
  if (!lastTextNode) return null;
  return {
    node: lastTextNode,
    offset: lastTextNode.textContent.length,
    clamped: true,
    totalLength,
  };
};

const getCaretRect = ($innerFrame, $outerBody, line, offset) => {
  const point = getTextPoint(line, offset);
  if (!point) return null;
  const range = line.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.setEnd(point.node, point.offset);
  const rect = range.getClientRects()[0] || range.getBoundingClientRect();
  if (!rect) return null;
  const innerRect = $innerFrame.get(0).getBoundingClientRect();
  const outerRect = $outerBody.get(0).getBoundingClientRect();
  return {
    left: rect.left + innerRect.left - outerRect.left,
    top: rect.top + innerRect.top - outerRect.top,
    height: rect.height || parseInt($(line).css('line-height'), 10) || 16,
    clamped: point.clamped,
    totalLength: point.totalLength,
  };
};

const submitCursorSelection = (rep) => {
  if (!initiated || !cursortraceEnabled) return;
  const Y = rep.selStart[0];
  const X = rep.selStart[1];
  if (last && Y === last[0] && X === last[1]) return;
  last = [Y, X];

  const message = {
    type: 'cursor',
    action: 'cursorPosition',
    locationY: Y,
    locationX: X,
    padId: pad.getPadId(),
    myAuthorId: pad.getUserId(),
  };

  if (!cursorThrottle) {
    cursorThrottle = createThrottle({send: sendCursor, windowMs: THROTTLE_MS});
  }
  cursorThrottle.submit(message);
};

exports.aceSelectionChanged = (hookName, args) => {
  submitCursorSelection(args.rep);
};

exports.handleClientMessage_CUSTOM = (hook, context) => {
  const action = context.payload.action;
  if (!cursortraceEnabled) return null;
  const authorId = context.payload.authorId;
  if (pad.getUserId() === authorId) return false;
  // Dont process our own caret position (yes we do get it..) -- This is not a bug
  const authorClass = exports.getAuthorClassName(authorId);

  const renderCursorPosition = (attempt = 0) => {
    // an author has sent this client a cursor position, we need to show it in the dom
    let authorName = context.payload.authorName;
    if (authorName === 'null' || authorName == null) {
      // If the users username isn't set then display a smiley face
      authorName = '😊';
    }
    // +1 as Etherpad line numbers start at 1
    const y = context.payload.locationY + 1;
    const x = context.payload.locationX;
    const outer = $('iframe[name="ace_outer"]').contents();
    const inner = outer.find('iframe');
    const $outerBody = outer.find('#outerdocbody');

    let stickUp = false;

    // Get the target Line
    const div = inner.contents().find('#innerdocbody').find(`div:nth-child(${y})`);
    // Is the line visible yet?
    if (div.length !== 0) {
      const caretRect = getCaretRect(inner, $outerBody, div.get(0), x);
      if (!caretRect) return;
      if (caretRect.clamped && attempt < 5) {
        requestAnimationFrame(() => renderCursorPosition(attempt + 1));
        return;
      }
      const {left, height} = caretRect;
      let {top} = caretRect;
      top -= height;
      if (top <= 0) { // If the tooltip wont be visible to the user because it's too high up
        stickUp = true;
        top += (height * 2);
        if (top < 0) { top = 0; } // handle case where caret is in 0,0
      }

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
          const outBody = $outerBody;

          // Remove all divs that already exist for this author
          $('iframe[name="ace_outer"]').contents().find(`.caret-${authorClass}`).remove();

          // Location of stick direction IE up or down
          const location = stickUp ? 'stickUp' : 'stickDown';

          // Create a new Div for this author
          const $indicator = $(`<div class='caretindicator ${location} caret-${authorClass}'
              style='height:${height}px;left:${left}px;top:${top}px;background-color:${color}'>
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
    }
  };

  if (action !== 'cursorPosition') return null;

  // Wait for the viewer DOM to apply the related edit so the measured position
  // matches the text layout currently on screen.
  requestAnimationFrame(renderCursorPosition);
  return null;
};
