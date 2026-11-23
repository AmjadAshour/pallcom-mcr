import React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { GripVertical, Trash2 } from 'lucide-react';
import { pendingMain, playoutCategories, projectTimeline } from '@mcr/shared';
import { formatDuration, formatWallClock, localDateTime } from './usePlayout.js';

const colors = {
  show: 'bg-sky-950 text-sky-200', promo: 'bg-violet-950 text-violet-200',
  ad: 'bg-amber-950 text-amber-200', filler: 'bg-emerald-950 text-emerald-200',
  live: 'bg-red-950 text-red-200'
};
const categoryNames = {
  show: 'برنامج', promo: 'ترويج', ad: 'فاصل إعلاني', filler: 'مادة احتياطية', live: 'مباشر'
};
const field = 'min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs disabled:opacity-60';

function TimelineRow({ item, times, lane, disabled, health, onChange, onRemove, onMove, ar }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const bad = health === 'missing' || health === 'unreadable';
  const style = { transition, transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined };
  const update = (values) => onChange({ ...item, ...values });

  return (
    <li ref={setNodeRef} style={style}
      className={`grid gap-2 rounded border p-2 sm:grid-cols-[auto_minmax(10rem,1fr)_auto_auto] sm:items-center ${isDragging ? 'relative z-10 bg-zinc-800' : 'bg-zinc-950'} ${bad ? 'border-red-700' : 'border-zinc-800'}`}>
      <button type="button" className="w-fit touch-none rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
        aria-label={(ar ? 'نقل ' : 'Reorder ') + item.title} disabled={disabled} {...attributes} {...listeners}>
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="sr-only">{ar ? 'عنوان العنصر' : 'Item title'}</span>
          <input className={field} value={item.title} onChange={(event) => update({ title: event.target.value })} maxLength={250} disabled={disabled} />
          {item.sceneName && <span className="truncate text-xs text-zinc-400">OBS · {item.sceneName}</span>}
          {bad && <span role="status" className="text-xs text-red-300">{health === 'missing'
            ? (ar ? 'الملف مفقود' : 'File missing') : (ar ? 'ملف غير قابل للقراءة' : 'Unreadable media')}</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="sr-only">{ar ? 'التصنيف' : 'Category'}</span>
          <select value={item.category} disabled={disabled || item.kind === 'live'} onChange={(event) => update({ category: event.target.value })}
            className={field + ' ' + colors[item.category]}>
            {(item.kind === 'live' ? ['live'] : playoutCategories.filter((value) => value !== 'live')).map((value) =>
              <option key={value} value={value}>{ar ? categoryNames[value] : value === 'ad' ? 'Ad break' : value}</option>)}
          </select>
          {item.kind === 'live' && !disabled ? <input key={item.durationMs} type="number" step="0.001" min="1" max="86400" dir="ltr"
            aria-label={ar ? 'مدة البث المباشر بالثواني' : 'Live duration in seconds'}
            className={field} defaultValue={item.durationMs / 1000} onBlur={(event) => {
              const next = Math.round(Number(event.target.value) * 1000);
              if (next >= 1000 && next <= 86400000 && next !== item.durationMs) update({ durationMs: next });
              else event.target.value = String(item.durationMs / 1000);
            }} />
            : <span className="font-mono text-xs text-zinc-400" dir="ltr">{formatDuration(item.durationMs, true)}</span>}
        </label>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        {lane === 'main' && <>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{ar ? 'بدء ثابت' : 'Fixed start'}</span>
            <input type="datetime-local" step="0.001" dir="ltr" className={field}
              value={localDateTime(item.hardStartAt)} disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                const ms = value ? new Date(value).getTime() : null;
                if (ms === null || Number.isFinite(ms)) update({ hardStartAt: ms });
              }} />
          </label>
          <div className="font-mono text-zinc-300">
            <span className="block" dir="ltr">{formatWallClock(times?.startAt)} → {formatWallClock(times?.endAt)}</span>
            {times?.trimmed && <span className="text-amber-300">{ar ? 'يقطعه بدء ثابت' : 'Preempted by fixed start'}</span>}
            {times?.skipped && <span className="text-amber-300">{ar ? 'لا يتّسع قبل البدء الثابت' : 'No time before fixed start'}</span>}
          </div>
        </>}
      </div>
      <div className="flex gap-1">
        <button className="rounded border border-zinc-800 px-2 disabled:opacity-30" disabled={disabled} onClick={() => onMove(-1)} aria-label={ar ? 'نقل لأعلى' : 'Move earlier'}>↑</button>
        <button className="rounded border border-zinc-800 px-2 disabled:opacity-30" disabled={disabled} onClick={() => onMove(1)} aria-label={ar ? 'نقل لأسفل' : 'Move later'}>↓</button>
        <button className="rounded p-1 text-red-300 disabled:opacity-30" disabled={disabled} onClick={onRemove} aria-label={ar ? 'إزالة العنصر' : 'Remove item'}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function PlayoutTimeline({ plan, snapshot, lane, assetHealth, canEdit, change, ar }) {
  const state = snapshot.state;
  const property = lane === 'main' ? 'items' : 'filler';
  const all = plan[property];
  const items = lane === 'main' && state.running ? pendingMain(plan, state.played) : all;
  const active = state.active;
  const locked = (item) => !canEdit || item.id === active?.item.id;
  const projected = projectTimeline(items, Math.max(snapshot.serverNow, active?.endsAt ?? snapshot.serverNow));
  const times = new Map(projected.map((value) => [value.id, value]));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function rearrange(from, to) {
    if (!canEdit || !from || !to || from === to) return;
    const editable = items.filter((entry) => !locked(entry));
    const first = editable.findIndex((entry) => entry.id === from);
    const last = editable.findIndex((entry) => entry.id === to);
    if (first < 0 || last < 0) return;
    const order = arrayMove(editable, first, last);
    const ids = new Set(editable.map((entry) => entry.id));
    let index = 0;
    change(property, all.map((entry) => ids.has(entry.id) ? order[index++] : entry));
  }

  if (!items.length) return <p className="py-6 text-sm text-zinc-400">{ar ? 'لا توجد عناصر قادمة. أضف مادة من المكتبة.' : 'No upcoming items. Add media from the library.'}</p>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active: dragged, over }) => rearrange(dragged.id, over?.id)}>
      <SortableContext items={items.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2">
          {items.map((entry, index) => <TimelineRow key={entry.id} item={entry} times={times.get(entry.id)} lane={lane} ar={ar}
            health={assetHealth[entry.assetId]} disabled={locked(entry)}
            onChange={(next) => change(property, all.map((item) => item.id === entry.id ? next : item))}
            onRemove={() => change(property, all.filter((item) => item.id !== entry.id))}
            onMove={(offset) => rearrange(entry.id, items[index + offset]?.id)} />)}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
