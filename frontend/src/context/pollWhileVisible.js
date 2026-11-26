export function pollWhileVisible(refresh, interval) {
  let controller;
  let timer;
  let nextAttempt = 0;

  function schedule() {
    if (document.hidden || controller || timer !== undefined) return;
    const wait = nextAttempt - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        schedule();
      }, wait);
      return;
    }
    const request = new AbortController();
    controller = request;
    void (async () => {
      let delay = interval;
      try {
        delay = (await refresh(request.signal)) ?? interval;
      } catch (error) {
        if (error.status === 429) delay = Math.max(interval, error.retryAfterMs ?? 60000);
      } finally {
        if (!request.signal.aborted) {
          controller = undefined;
          nextAttempt = Date.now() + delay;
          schedule();
        }
      }
    })();
  }

  function pause() {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }

  function onVisibilityChange() {
    if (document.hidden) pause();
    else schedule();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  schedule();
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    pause();
  };
}
