import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../../context/api.js';

export function usePlayout(path, stationId) {
  const [snapshot, setSnapshot] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  function accept(next) {
    if (!next || next.stationId !== stationId) return;
    const receivedAt = performance.now();
    setSnapshot((current) => current && current.serverNow > next.serverNow ? current : { ...next, receivedAt });
  }

  useEffect(() => {
    const controller = new AbortController();
    let socket;
    let reconnect;
    const refresh = async () => {
      try {
        const { data } = await api(path, { signal: controller.signal });
        if (!controller.signal.aborted) { accept(data); setError(''); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      }
    };
    void refresh();
    socket = io({ withCredentials: true, autoConnect: false, reconnectionDelay: 800 });

    function scheduleReconnect() {
      clearTimeout(reconnect);
      reconnect = setTimeout(async () => {
        await refresh();
        if (!controller.signal.aborted && !socket.connected && !socket.active) socket.connect();
      }, 1500);
    }
    socket.on('connect', () => {
      socket.timeout(5000).emit('playout:subscribe', stationId, (timeoutError, result) => {
        if (controller.signal.aborted) return;
        if (timeoutError || result?.error) {
          setError(result?.error || 'Playout subscription timed out');
          socket.disconnect();
          scheduleReconnect();
          return;
        }
        setConnected(true);
        accept(result.data);
        setError('');
      });
    });
    socket.on('playout:state', (data) => { if (!controller.signal.aborted) accept(data); });
    socket.on('disconnect', () => {
      setConnected(false);
      if (!controller.signal.aborted && !socket.active) scheduleReconnect();
    });
    socket.on('connect_error', () => {
      setConnected(false);
      if (!controller.signal.aborted && !socket.active) scheduleReconnect();
    });
    const poll = setInterval(() => { if (!socket.connected) void refresh(); }, 2500);
    socket.connect();
    return () => {
      controller.abort();
      clearInterval(poll);
      clearTimeout(reconnect);
      socket.disconnect();
    };
  }, [path, stationId]);

  return { snapshot, connected, error, accept };
}

export function formatDuration(ms, precision = false) {
  if (!Number.isFinite(ms)) return '—';
  const value = Math.max(0, Math.floor(ms));
  const seconds = Math.floor(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const pad = (part) => String(part).padStart(2, '0');
  return [hours, Math.floor(seconds / 60) % 60, seconds % 60].map(pad).join(':') +
    (precision ? '.' + String(value % 1000).padStart(3, '0') : '');
}

export function formatWallClock(timestamp, date = false) {
  if (!Number.isFinite(timestamp)) return '—';
  const value = new Date(timestamp);
  const base = value.toLocaleTimeString([], { hour12: false });
  const precise = base + '.' + String(value.getMilliseconds()).padStart(3, '0');
  return date ? value.toLocaleDateString() + ' ' + precise : precise;
}

export function localDateTime(timestamp) {
  if (timestamp === null || timestamp === undefined) return '';
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
