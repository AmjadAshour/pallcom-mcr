import React, { useEffect, useState } from 'react';
import { api, stationPath } from '../context/api.js';

export function ProgramPreview({ station, preview = false }) {
  const [frame, setFrame] = useState(null);

  useEffect(() => {
    if (station.status !== 'ONLINE' || !station.ready || (preview && !station.studioModeEnabled)) return;
    const controller = new AbortController();
    let timer;

    async function refresh() {
      try {
        const { data } = await api(stationPath(station.id, preview ? '/preview-image?bus=preview' : '/preview-image'), { signal: controller.signal });
        if (!controller.signal.aborted) setFrame(data.imageData);
      } catch {
        if (!controller.signal.aborted) setFrame(null);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 3000);
      }
    }

    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [station.id, station.status, station.ready, station.studioModeEnabled, preview]);

  return station.ready && (!preview || station.studioModeEnabled) && frame
    ? <img src={frame} alt={`${preview ? 'Preview' : 'Program'} image from ${station.name}`} className="h-full w-full object-contain" />
    : <span className="text-xs text-zinc-400">Scene image unavailable</span>;
}
