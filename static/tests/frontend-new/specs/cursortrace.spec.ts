import {expect, test} from '@playwright/test';
import {goToNewPad, goToPad} from 'ep_etherpad-lite/tests/frontend-new/helper/padHelper';

const getIndicatorPosition = async (page) => await page.evaluate(() => {
  const outerDoc = document.querySelector('iframe[name="ace_outer"]')!.contentDocument!;
  const indicator = outerDoc.querySelector<HTMLElement>('.caretindicator');
  if (!indicator) return null;
  return {
    left: Number.parseFloat(indicator.style.left || '0'),
    top: Number.parseFloat(indicator.style.top || '0'),
  };
});

const waitForIndicatorPosition = async (page) => {
  for (let i = 0; i < 20; i++) {
    const position = await getIndicatorPosition(page);
    if (position) return position;
    await page.waitForTimeout(100);
  }
  return null;
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

  test('remote client receives the final horizontal cursor position', async ({browser}) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    const padId = await goToNewPad(a);
    await goToPad(b, padId);
    await b.evaluate(() => {
      (window as any).__cursorRecv = [];
      const collab = (window as any).pad.collabClient;
      const orig = collab.handleMessageFromServer;
      collab.handleMessageFromServer = function (msg: any, ...args: any[]) {
        const data = msg && msg.data;
        const payload = data && data.payload;
        if (data && data.type === 'CUSTOM' &&
            payload && payload.action === 'cursorPosition') {
          (window as any).__cursorRecv.push(JSON.parse(JSON.stringify(payload)));
        }
        return orig.apply(this, [msg, ...args]);
      };
    });

    const innerA = a.frame('ace_inner')!;
    await innerA.locator('#innerdocbody').click();
    await a.keyboard.press('Control+a');
    await a.keyboard.press('Delete');
    await a.keyboard.type('ABCDE');
    await a.keyboard.press('ArrowLeft');
    await a.keyboard.press('ArrowLeft');
    await b.waitForTimeout(1000);
    const received = await b.evaluate(() => (window as any).__cursorRecv);
    expect(received.length).toBeGreaterThan(0);
    expect(received.at(-1).locationX).toBe(3);
    expect(received.at(-1).locationY).toBe(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('remote caret stays rendered on narrow screens with wrapped text', async ({browser}) => {
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
    await a.keyboard.type('ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ');
    const wrappedLinePosition = await waitForIndicatorPosition(b);
    expect(wrappedLinePosition).not.toBeNull();
    expect(Number.isFinite(wrappedLinePosition!.left)).toBe(true);
    expect(Number.isFinite(wrappedLinePosition!.top)).toBe(true);

    for (let i = 0; i < 50; i++) await a.keyboard.press('ArrowLeft');
    const firstLinePosition = await waitForIndicatorPosition(b);
    expect(firstLinePosition).not.toBeNull();
    expect(Number.isFinite(firstLinePosition!.left)).toBe(true);
    expect(Number.isFinite(firstLinePosition!.top)).toBe(true);

    await ctxA.close();
    await ctxB.close();
  });
});
