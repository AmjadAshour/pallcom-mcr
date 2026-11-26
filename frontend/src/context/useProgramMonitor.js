import { useEffect, useState } from 'react';
import { api } from './api.js';
import { pollWhileVisible } from './pollWhileVisible.js';

export function useMonitorFrame(path, running, interval = 1000) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!running) { setSnapshot(null); return; }
    return pollWhileVisible(async (signal) => {
      try {
        const { data } = await api(path, { signal });
        if (!signal.aborted) setSnapshot({ path, frame: data });
      } catch (error) {
        if (!signal.aborted && error.status !== 429) setSnapshot(null);
        throw error;
      }
    }, interval);
  }, [path, running, interval]);
  return running && snapshot?.path === path ? snapshot.frame : null;
}
