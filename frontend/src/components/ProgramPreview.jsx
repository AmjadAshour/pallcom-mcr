import React, { useEffect, useState } from 'react';
import { api, stationPath } from '../context/api.js';
import { pollWhileVisible } from '../context/pollWhileVisible.js';

export function ProgramPreview({ station, preview = false }) {
  const [frame, setFrame] = useState(null);

  useEffect(() => {
    if (station.status !== 'ONLINE' || !station.ready || (preview && !station.studioModeEnabled)) return;
    return pollWhileVisible(async (signal) => {
      try {
        const { data } = await api(stationPath(station.id, preview ? '/preview-image?bus=preview' : '/preview-image'), { signal });
        if (!signal.aborted) setFrame(data.imageData);
      } catch (error) {
        if (!signal.aborted && error.status !== 429) setFrame(null);
        throw error;
      }
    }, 3000);
  }, [station.id, station.status, station.ready, station.studioModeEnabled, preview]);

  return station.ready && (!preview || station.studioModeEnabled) && frame
    ? <img src={frame} alt={`${preview ? 'Preview' : 'Program'} image from ${station.name}`} className="h-full w-full object-contain" />
    : <span className="text-xs text-zinc-400">Scene image unavailable</span>;
}
