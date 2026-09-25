import type { Page } from '@playwright/test';

/** Consecutive animation frames with nothing finite running before the page counts as settled. */
const QUIET_FRAMES = 5;

/**
 * Runs `inspect` against the page's settled frame, with the animation clock stopped.
 *
 * An audit that reads a frame mid-animation measures colours that no one ever
 * reads at rest. Issue #31 was exactly this: the dashboard audit caught the
 * "Welcome back" toast part-way through its 0.4s fade-out, when its text was at
 * about half opacity, and axe reported a 2.3–2.6:1 contrast that the settled toast
 * does not have. Waiting longer only moves the race. The toast dismisses itself
 * on a timer, so its fade can start while axe is still running.
 *
 * So there are two steps:
 * 1. Wait until no finite CSS animation or transition has run for a few frames
 *    in a row. Several frames, not one, because a toast mounts invisible and
 *    starts its entrance a frame or two later, once it has measured itself.
 *    Infinite animations (spinners, skeleton pulses) never finish, and are
 *    ignored.
 * 2. Stop Chromium's animation clock while `inspect` runs. An animation that
 *    starts during the audit then stays on its first frame. For a toast's exit,
 *    that frame is fully opaque and in place, which is what the user reads.
 *
 * Chromium only, like the suite's single project: step 2 uses the DevTools
 * Animation domain.
 */
export async function withAnimationsSettled<T>(page: Page, inspect: () => Promise<T>): Promise<T> {
  await page.evaluate(() => {
    (window as Window & { __quietFrames?: number }).__quietFrames = 0;
  });
  await page.waitForFunction(
    (needed) => {
      const w = window as Window & { __quietFrames?: number };
      const busy = document
        .getAnimations()
        .some(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        );
      w.__quietFrames = busy ? 0 : (w.__quietFrames ?? 0) + 1;
      return w.__quietFrames >= needed;
    },
    QUIET_FRAMES,
    { polling: 'raf' },
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  try {
    return await inspect();
  } finally {
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await cdp.detach();
  }
}
