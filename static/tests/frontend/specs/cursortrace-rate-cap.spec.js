'use strict';

// eslint-disable-next-line no-redeclare
const {test, expect} = require('@playwright/test');

// Etherpad core's playwright config provides a base URL pointing at the dev
// server started by the workflow (`pnpm run dev` on port 9001).

test('ep_cursortrace caps broadcast rate at ~10 Hz', async ({browser}) => {
  const padId = `cursortrace-rate-${Date.now()}`;
  const padUrl = `/p/${padId}`;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto(padUrl);
  await b.goto(padUrl);

  // Wait for both editors to be ready.
  for (const page of [a, b]) {
    await page.waitForSelector('iframe[name="ace_outer"]');
    const outer = page.frameLocator('iframe[name="ace_outer"]');
    await outer.locator('iframe[name="ace_inner"]').waitFor();
  }

  // Seed pad with multiple lines so the caret has somewhere to move.
  const innerA = a.frameLocator('iframe[name="ace_outer"]')
      .frameLocator('iframe[name="ace_inner"]');
  await innerA.locator('#innerdocbody').click();
  for (let i = 0; i < 20; i++) {
    await a.keyboard.type(`line ${i}`);
    await a.keyboard.press('Enter');
  }

  // Wait until B has received the edits (line count stabilises).
  await b.waitForTimeout(500);

  // Install a counter on B that increments on every cursortrace frame.
  await b.evaluate(() => {
    window.__cursorFrames = 0;
    const orig = window.pad.collabClient.handleMessageFromServer;
    window.pad.collabClient.handleMessageFromServer = function (msg, ...args) {
      const data = msg && msg.data;
      const payload = data && data.payload;
      if (data && data.type === 'CUSTOM' &&
          payload && payload.action === 'cursorPosition') {
        window.__cursorFrames += 1;
      }
      return orig.apply(this, [msg, ...args]);
    };
  });

  // On A, drag the caret rapidly across many lines for ~1 s.
  // 30 keypresses with 30 ms between them = ~900 ms of motion.
  await innerA.locator('#innerdocbody').click();
  const start = Date.now();
  for (let i = 0; i < 30; i++) {
    await a.keyboard.press(i % 2 === 0 ? 'ArrowDown' : 'ArrowUp');
    await a.waitForTimeout(30);
  }
  const elapsed = Date.now() - start;

  // Allow the trailing flush to land.
  await b.waitForTimeout(250);

  const frames = await b.evaluate(() => window.__cursorFrames);

  // Cap is 10 Hz on the client + 10 Hz on the server. Over ~1 s, B should see
  // no more than ~12 frames (10 Hz + slack for window-edge effects).
  expect(frames).toBeLessThanOrEqual(12);
  // Sanity: at least one frame got through (the feature still works).
  expect(frames).toBeGreaterThan(0);

  // Telemetry for debugging when this fails:
  console.log(`cursortrace frames=${frames} over ${elapsed} ms`);

  await ctxA.close();
  await ctxB.close();
});
