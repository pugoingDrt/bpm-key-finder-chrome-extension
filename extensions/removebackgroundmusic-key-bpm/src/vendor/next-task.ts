/**
 * Resolves on the next task, so long work done in chunks lets the page
 * draw and respond in between. A message on a channel rather than
 * `setTimeout(0)`: timers in a hidden tab wait up to a second (a minute
 * after a while), so work left running in a background tab would crawl.
 */
export function nextTask(): Promise<void> {
  if (typeof MessageChannel === 'undefined')
    return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
