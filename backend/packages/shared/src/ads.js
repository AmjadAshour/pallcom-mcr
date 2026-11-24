// Wall time gates eligibility. A separate elapsed clock drives the repeating playlist.
function placementCursor(clock, transport) {
  if (transport.paused) return transport.offset;
  return transport.offset + Math.max(0, clock - transport.anchor);
}

function playlistPosition(items, elapsed) {
  const cycle = items.reduce((sum, item) => sum + item.duration + item.gap, 0);
  if (!cycle) return null;
  let offset = elapsed % cycle;
  for (const [index, item] of items.entries()) {
    const span = item.duration + item.gap;
    if (offset < span) return { item, index, offset, remaining: span - offset };
    offset -= span;
  }
}

export function adLayer(placement, transport, wall, clock) {
  if (
    !placement.enabled ||
    transport.disabled ||
    wall < placement.start ||
    (placement.end != null && wall >= placement.end)
  )
    return null;
  const slot = playlistPosition(placement.items, placementCursor(clock, transport));
  if (!slot || slot.offset >= slot.item.duration) return null;
  const { item, offset } = slot;
  if ((item.start != null && wall < item.start) || (item.end != null && wall >= item.end)) return null;
  const progress = offset / item.duration;
  return {
    asset: item.asset,
    elapsed: offset,
    alpha: Math.min(
      1,
      item.enter ? offset / item.enter : 1,
      item.exit ? (item.duration - offset) / item.exit : 1
    ),
    x: placement.x + item.dx * progress,
    y: placement.y + item.dy * progress,
    w: placement.w,
    h: placement.h
  };
}

export function transportAction(placement, transport, action, clock) {
  const offset = placementCursor(clock, transport);
  const next = { ...transport, offset, anchor: Math.max(clock, placement.start || 0) };
  if (action === 'skip') next.offset += playlistPosition(placement.items, offset)?.remaining ?? 0;
  if (action === 'pause') next.paused = true;
  if (action === 'resume') next.paused = false;
  if (action === 'disable') next.disabled = true;
  return next;
}

export const placementOrder = (a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Resolve station-local civil time. Reject nonexistent and ambiguous DST minutes.
export function scheduledInstant(value, zone) {
  if (!value) return null;
  const nominal = Date.parse(value + ':00Z');
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const local = (time) => formatter.format(time).replace(' ', 'T');
  const offsets = new Set(
    [-86400000, 0, 86400000].map((delta) => Date.parse(local(nominal + delta) + ':00Z') - nominal - delta)
  );
  const matches = [...offsets].map((offset) => nominal - offset).filter((time) => local(time) === value);
  if (matches.length !== 1) throw Error('Choose an unambiguous local time in the schedule time zone');
  return matches[0];
}
