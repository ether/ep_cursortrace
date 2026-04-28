import {expect, test} from '@playwright/test';
import {goToNewPad} from 'ep_etherpad-lite/tests/frontend-new/helper/padHelper';

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
});
