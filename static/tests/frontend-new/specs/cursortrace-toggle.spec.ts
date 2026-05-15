import {expect, test} from '@playwright/test';
import {goToNewPad, goToPad} from 'ep_etherpad-lite/tests/frontend-new/helper/padHelper';

test.describe('ep_cursortrace settings', () => {
  test('settings toggle is rendered with i18n wiring', async ({page}) => {
    await goToNewPad(page);
    await expect(page.locator('#options-cursortrace')).toBeAttached();
    const label = page.locator('label[for="options-cursortrace"]');
    await expect(label).toHaveAttribute(
        'data-l10n-id', 'ep_cursortrace.settings.showRemoteCarets');
    await expect(label).toHaveText('Show other users locations');
  });

  test('disabling the user setting hides remote carets for that user', async ({browser}) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    const padId = await goToNewPad(a);
    await goToPad(b, padId);

    await expect(b.locator('#options-cursortrace')).toBeChecked();
    await b.evaluate(() => {
      document.querySelector<HTMLInputElement>('#options-cursortrace')!.click();
    });
    await expect(b.locator('#options-cursortrace')).not.toBeChecked();

    const innerA = a.frame('ace_inner')!;
    await innerA.locator('#innerdocbody').click();
    await a.keyboard.type('ABCDE');
    await a.keyboard.press('ArrowLeft');
    await a.keyboard.press('ArrowLeft');
    await b.waitForTimeout(1000);

    const remoteCaretCount = () => b.evaluate(() => {
      const outerDoc = document.querySelector('iframe[name="ace_outer"]')!.contentDocument!;
      return outerDoc.querySelectorAll('.caretindicator').length;
    });
    expect(await remoteCaretCount()).toBe(0);

    await b.evaluate(() => {
      document.querySelector<HTMLInputElement>('#options-cursortrace')!.click();
    });
    await expect(b.locator('#options-cursortrace')).toBeChecked();

    await a.keyboard.press('ArrowRight');
    await b.waitForTimeout(1000);
    expect(await remoteCaretCount()).toBeGreaterThan(0);

    await ctxA.close();
    await ctxB.close();
  });
});
