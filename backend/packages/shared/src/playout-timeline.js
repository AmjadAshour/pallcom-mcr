export const categories = ['show', 'promo', 'ad', 'filler', 'live'];

export const emptyPlan = () => ({
  revision: 0, items: [], filler: [], loop: false, decks: [], backupScene: '',
  graphics: { logoSource: '', lowerThirdSource: '', tickerSource: '', logo: true, lowerThird: false, ticker: false, hideLogoDuringAds: true }
});

export const emptyState = () => ({
  running: false, mode: 'idle', active: null, played: [], fillerIndex: 0,
  alert: null, stationReady: false
});

export function pendingMain(plan, played) {
  const aired = new Set(played);
  return plan.items.filter((item) => !aired.has(item.id));
}

export function fixedEvents(items) {
  return items.filter((item) => item.hardStartAt !== null)
    .sort((a, b) => a.hardStartAt - b.hardStartAt);
}

export function projectTimeline(items, startAt) {
  const fixed = fixedEvents(items);
  let cursor = startAt;
  return items.map((item) => {
    const start = item.hardStartAt ?? cursor;
    if (item.hardStartAt === null && fixed.some((event) => event.hardStartAt === cursor)) {
      return { id: item.id, startAt: null, endAt: null, trimmed: false, skipped: true };
    }
    const nominalEnd = start + item.durationMs;
    const interrupt = fixed.find((event) => event.hardStartAt > start && event.hardStartAt < nominalEnd);
    cursor = interrupt?.hardStartAt ?? nominalEnd;
    return { id: item.id, startAt: start, endAt: cursor, trimmed: Boolean(interrupt), skipped: false };
  });
}

export function estimateNext(plan, state, now) {
  const main = pendingMain(plan, state.played);
  const fixed = fixedEvents(main);
  const boundary = Math.max(now, state.active?.endsAt ?? now);
  const hard = fixed.find((item) => item.hardStartAt <= boundary);
  if (hard) return { ...hard, startAt: hard.hardStartAt };
  if (main[0] && main[0].hardStartAt === null) return { ...main[0], startAt: boundary };
  if (plan.loop && !main.length) {
    const item = plan.items.find((candidate) => candidate.hardStartAt === null);
    if (item) return { ...item, startAt: boundary };
  }
  if (plan.filler.length) {
    return { ...plan.filler[state.fillerIndex % plan.filler.length], startAt: boundary };
  }
  return fixed[0] ? { ...fixed[0], startAt: fixed[0].hardStartAt } : null;
}
