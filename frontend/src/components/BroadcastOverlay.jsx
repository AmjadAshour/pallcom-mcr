import React, { useEffect, useState } from 'react';
import './broadcast-overlay.css';

export function OverlayCanvas({ items }) {
  const ad = items.find((item) => item.kind === 'ad');
  const logo = items.find((item) => item.kind === 'logo');
  const ticker = items.find((item) => item.kind === 'ticker');
  const arabic = /[\u0600-\u06ff]/.test(ticker?.content ?? '');

  return (
    <div className={ad ? 'broadcast-canvas broadcast-canvas-with-ad' : 'broadcast-canvas'}>
      {logo?.image && <img className="broadcast-logo" src={logo.image} alt="" />}
      {ad && <aside className="broadcast-ad" dir="auto">
        {ad.image && <div className="broadcast-ad-art"><img src={ad.image} alt="" /></div>}
        {ad.content && <p>{ad.content}</p>}
      </aside>}
      {ticker && <div className="broadcast-ticker" dir={arabic ? 'rtl' : 'ltr'}>
        <strong>{arabic ? 'عاجل' : 'BREAKING'}</strong>
        <div className="broadcast-ticker-track">
          <span className={arabic ? 'broadcast-scroll-rtl' : 'broadcast-scroll-ltr'}>{ticker.content}</span>
        </div>
      </div>}
    </div>
  );
}

export function BroadcastOverlay({ token }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    document.documentElement.classList.add('broadcast-output');
    const controller = new AbortController();
    let pollTimer;
    let expiryTimer;
    const refresh = async () => {
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 3500);
      const started = performance.now();
      try {
        const response = await fetch('/api/v1/public/graphics/' + token, {
          cache: 'no-store', signal: request.signal
        });
        if (!response.ok) throw new Error('Overlay unavailable');
        const { data } = await response.json();
        if (controller.signal.aborted) return;
        const deadlines = data.map((item) => ({
          ...item, deadline: item.remainingMs === null ? Infinity : started + item.remainingMs
        }));
        clearTimeout(expiryTimer);
        function update() {
          const now = performance.now();
          const visible = deadlines.filter((item) => item.deadline > now);
          setItems(visible);
          const next = Math.min(...visible.map((item) => item.deadline));
          if (Number.isFinite(next)) expiryTimer = setTimeout(update, Math.ceil(next - now));
        }
        update();
      } catch {
        if (!controller.signal.aborted) {
          clearTimeout(expiryTimer);
          setItems([]);
        }
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abort);
        if (!controller.signal.aborted) pollTimer = setTimeout(refresh, 2000);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(pollTimer);
      clearTimeout(expiryTimer);
      document.documentElement.classList.remove('broadcast-output');
    };
  }, [token]);

  return <main className="broadcast-output-frame"><OverlayCanvas items={items} /></main>;
}
