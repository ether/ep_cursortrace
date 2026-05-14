import {expect, test} from '@playwright/test';
import {goToNewPad, goToPad} from 'ep_etherpad-lite/tests/frontend-new/helper/padHelper';

const getTextPoint = (line: Element, offset: number) => {
  const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let lastTextNode: Text | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    lastTextNode = node as Text;
    const len = lastTextNode.textContent?.length ?? 0;
    if (remaining <= len) return {node: lastTextNode, offset: remaining};
    remaining -= len;
  }
  if (!lastTextNode) return null;
  return {node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0};
};

test.beforeEach(async ({page}) => {
  await goToNewPad(page);
});

test.describe('ep_cursortrace', () => {
  test('plugin is loaded and exposes itself in clientVars', async ({page}) => {
    const enabled = await page.evaluate(
      () => (window as any).clientVars?.plugins?.plugins?.ep_cursortrace != null);
    expect(enabled).toBe(true);
  });

  test('caretindicator stylesheet is injected into the inner editor', async ({page}) => {
    // ep_cursortrace registers an aceEditorCSS hook that injects
    // static/css/ace_inner.css into the inner editor iframe. Verify the
    // .caretindicator style ends up reachable from the inner document.
    const innerFrame = page.frame('ace_inner')!;
    const hasCaretIndicatorRule = await innerFrame.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule.cssText.includes('.caretindicator')) return true;
          }
        } catch {
          // Cross-origin stylesheets throw on cssRules access — skip.
        }
      }
      return false;
    });
    expect(hasCaretIndicatorRule).toBe(true);
  });

  test('remote caret is not rendered one character to the left', async ({browser}) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    const padId = await goToNewPad(a);
    await goToPad(b, padId);

    const innerA = a.frame('ace_inner')!;
    await innerA.locator('#innerdocbody').click();
    await a.keyboard.press('Control+a');
    await a.keyboard.press('Delete');
    await a.keyboard.type('ABCDE');
    await a.keyboard.press('ArrowLeft');
    await a.keyboard.press('ArrowLeft');
    await b.waitForTimeout(1000);

    const delta = await b.evaluate(() => {
      const getTextPoint = (line, offset) => {
        const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, offset);
        let lastTextNode = null;
        let node;
        while ((node = walker.nextNode())) {
          lastTextNode = node;
          const len = node.textContent.length;
          if (remaining <= len) return {node, offset: remaining};
          remaining -= len;
        }
        if (!lastTextNode) return null;
        return {node: lastTextNode, offset: lastTextNode.textContent.length};
      };
      const outerDoc = document.querySelector('iframe[name="ace_outer"]')!.contentDocument!;
      const outerBody = outerDoc.querySelector('#outerdocbody')!;
      const innerFrame = outerDoc.querySelector('iframe')!;
      const innerDoc = innerFrame.contentDocument!;
      const line = Array.from(innerDoc.querySelectorAll('#innerdocbody div')).find((d) => d.textContent)!;
      const point = getTextPoint(line, 3)!;
      const range = innerDoc.createRange();
      range.setStart(point.node, point.offset);
      range.setEnd(point.node, point.offset);
      const caretRect = range.getClientRects()[0] || range.getBoundingClientRect();
      const outerRect = outerBody.getBoundingClientRect();
      const innerRect = innerFrame.getBoundingClientRect();
      const expectedLeft = caretRect.left + innerRect.left - outerRect.left;
      const indicator = outerDoc.querySelector('.caretindicator')!;
      const indicatorRect = indicator.getBoundingClientRect();
      const actualLeft = indicatorRect.left - outerRect.left;
      return actualLeft - expectedLeft;
    });

    expect(Math.abs(delta)).toBeLessThanOrEqual(2);
    await ctxA.close();
    await ctxB.close();
  });

  test('remote caret top matches wrapped line on narrow screens', async ({browser}) => {
    const ctxA = await browser.newContext({viewport: {width: 1280, height: 900}});
    const ctxB = await browser.newContext({viewport: {width: 500, height: 900}});
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    const padId = await goToNewPad(a);
    await goToPad(b, padId);

    const innerA = a.frame('ace_inner')!;
    await innerA.locator('#innerdocbody').click();
    await a.keyboard.press('Control+a');
    await a.keyboard.press('Delete');
    await a.keyboard.type('ABCDEFGHIJKLMNOPQRSTU');
    await a.keyboard.press('ArrowLeft');
    await b.waitForTimeout(1000);

    const delta = await b.evaluate(() => {
      const getTextPoint = (line, offset) => {
        const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let remaining = Math.max(0, offset);
        let lastTextNode = null;
        let node;
        while ((node = walker.nextNode())) {
          lastTextNode = node;
          const len = node.textContent.length;
          if (remaining <= len) return {node, offset: remaining};
          remaining -= len;
        }
        if (!lastTextNode) return null;
        return {node: lastTextNode, offset: lastTextNode.textContent.length};
      };
      const outerDoc = document.querySelector('iframe[name="ace_outer"]')!.contentDocument!;
      const outerBody = outerDoc.querySelector('#outerdocbody')!;
      const innerFrame = outerDoc.querySelector('iframe')!;
      const innerDoc = innerFrame.contentDocument!;
      const line = Array.from(innerDoc.querySelectorAll('#innerdocbody div')).find((d) => d.textContent)!;
      const point = getTextPoint(line, 20)!;
      const range = innerDoc.createRange();
      range.setStart(point.node, point.offset);
      range.setEnd(point.node, point.offset);
      const caretRect = range.getClientRects()[0] || range.getBoundingClientRect();
      const outerRect = outerBody.getBoundingClientRect();
      const innerRect = innerFrame.getBoundingClientRect();
      const expectedTop = caretRect.top + innerRect.top - outerRect.top;
      const indicator = outerDoc.querySelector('.caretindicator')!;
      const indicatorRect = indicator.getBoundingClientRect();
      const actualTop = indicatorRect.top - outerRect.top;
      return actualTop - expectedTop;
    });

    expect(Math.abs(delta)).toBeLessThanOrEqual(2);
    await ctxA.close();
    await ctxB.close();
  });
});
