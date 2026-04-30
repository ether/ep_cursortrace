import {expect, test} from '@playwright/test';
import {goToNewPad, goToPad} from 'ep_etherpad-lite/tests/frontend-new/helper/padHelper';

test('ep_cursortrace caps broadcast rate at ~10 Hz', async ({browser}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  const padId = await goToNewPad(a);
  await goToPad(b, padId);

  // Seed a few lines on A so the caret has somewhere to move.
  const innerA = a.frame('ace_inner')!;
  await innerA.locator('#innerdocbody').click();
  for (let i = 0; i < 20; i++) {
    await a.keyboard.type(`line ${i}`);
    await a.keyboard.press('Enter');
  }

  // Wait until B has received the edits.
  await b.waitForTimeout(500);

  // Install a counter on B that increments on every cursortrace frame.
  await b.evaluate(() => {
    (window as any).__cursorFrames = 0;
    const collab = (window as any).pad.collabClient;
    const orig = collab.handleMessageFromServer;
    collab.handleMessageFromServer = function (msg: any, ...args: any[]) {
      const data = msg && msg.data;
      const payload = data && data.payload;
      if (data && data.type === 'CUSTOM' &&
          payload && payload.action === 'cursorPosition') {
        (window as any).__cursorFrames += 1;
      }
      return orig.apply(this, [msg, ...args]);
    };
  });

  // Drag the caret on A for ~1 s. 30 keypresses with 30 ms between them.
  await innerA.locator('#innerdocbody').click();
  const start = Date.now();
  for (let i = 0; i < 30; i++) {
    await a.keyboard.press(i % 2 === 0 ? 'ArrowDown' : 'ArrowUp');
    await a.waitForTimeout(30);
  }
  const elapsed = Date.now() - start;

  // Allow the trailing flush to land.
  await b.waitForTimeout(250);

  const frames = await b.evaluate(() => (window as any).__cursorFrames);

  // 10 Hz client + 10 Hz server cap. Over ~1 s, ≤12 frames (10 + slack).
  expect(frames).toBeLessThanOrEqual(12);
  expect(frames).toBeGreaterThan(0);

  // Telemetry — surfaces in test output when CI fails.
  // eslint-disable-next-line no-console
  console.log(`cursortrace frames=${frames} over ${elapsed} ms`);

  await ctxA.close();
  await ctxB.close();
});
