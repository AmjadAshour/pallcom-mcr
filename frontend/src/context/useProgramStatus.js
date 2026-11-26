import { useEffect, useState } from 'react';
import { api, stationPath } from './api.js';
import { pollWhileVisible } from './pollWhileVisible.js';

export function useProgramStatus(stationId, enabled = true, interval = 3000) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    return pollWhileVisible(async signal => {
      try {
        const { data } = await api(stationPath(stationId, '/program'), { signal });
        if (!signal.aborted) setStatus(data);
        return data.configured ? interval : 60000;
      } catch (error) {
        if (!signal.aborted && error.status !== 429) setStatus(null);
        throw error;
      }
    }, interval);
  }, [stationId, enabled, interval]);
  return status;
}
