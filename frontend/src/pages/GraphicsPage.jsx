import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, stationPath } from '../context/api.js';
import { OverlayCanvas } from '../components/BroadcastOverlay.jsx';
import { useMcrStore } from '../context/useMcrStore.js';
import { useProgramStatus } from '../context/useProgramStatus.js';
import { ProgramAds } from '../components/ProgramAds.jsx';
import { ProgramWatermark } from '../components/ProgramWatermark.jsx';
import { ProgramTicker } from '../components/ProgramTicker.jsx';

const kinds = ['ad', 'logo', 'ticker'];
const labels = {
  ar: {
    title: 'الجرافيكس والشريط', station: 'محطة البث', noStation: 'أضف محطة بث لبدء إعداد الجرافيكس.',
    ad: 'الإعلان الجانبي', logo: 'اللوغو · أعلى اليمين', ticker: 'شريط الأخبار العاجلة · أسفل البث',
    text: 'النص', image: 'الصورة', imageHelp: 'PNG أو JPEG أو WebP، حتى 512 كيلوبايت',
    removeImage: 'إزالة الصورة', duration: 'مدة العرض بالثواني', durationHelp: 'صفر = يستمر حتى توقفه',
    save: 'حفظ التعديل', publish: 'إظهار على البث', hide: 'إيقاف العرض', delete: 'حذف',
    visible: 'معروض', hidden: 'مخفي', expired: 'انتهت المدة', second: 'ث', loading: 'جارٍ تحميل الجرافيكس…',
    preview: 'معاينة العناصر المنشورة',
    obs: 'ربط محطة البث مع OBS', copy: 'نسخ رابط المصدر', copied: 'تم النسخ',
    rotate: 'تجديد الرابط', rotateConfirm: 'سيتوقف الرابط القديم فورًا. تابع إذا كنت مستعدًا لتحديث المصدر في OBS.',
    how: 'في OBS، اضبط مصدر المتصفح مرة واحدة فوق الفيديو. الصق الرابط واضبط أبعاده على مقاس اللوحة الأساسية بالكامل (مثل 1920 × 1080). من «التحويل» اختر «إعادة ضبط التحويل» ثم «ملاءمة للشاشة». الإعلان يثبت على اليسار بعرض 20%، والشعار أعلى اليمين، والشريط أسفل البث. استخدم مصدر المتصفح نفسه في كل مشهد.',
    access: 'تحتاج إلى صلاحية التحكم بالمحطة لإدارة الجرافيكس.',
    select: 'اختر محطة', confirm: 'حذف هذا العنصر من المحطة؟', error: 'تعذّر تنفيذ العملية', invalidImage: 'اختر صورة PNG أو JPEG أو WebP بحجم لا يتجاوز 512 كيلوبايت.'
  },
  en: {
    title: 'Broadcast graphics', station: 'Broadcast station', noStation: 'Add a station to configure its graphics.',
    ad: 'Side advertisement', logo: 'Logo · upper right', ticker: 'Breaking news ticker · bottom',
    text: 'Text', image: 'Image', imageHelp: 'PNG, JPEG, or WebP up to 512 KB',
    removeImage: 'Remove image', duration: 'Display time in seconds', durationHelp: 'Zero keeps it visible until stopped',
    save: 'Save changes', publish: 'Show on broadcast', hide: 'Stop showing', delete: 'Delete',
    visible: 'Visible', hidden: 'Hidden', expired: 'Expired', second: 's', loading: 'Loading graphics…',
    preview: 'Published graphics preview',
    obs: 'Connect this station to OBS', copy: 'Copy source URL', copied: 'Copied',
    rotate: 'Rotate URL', rotateConfirm: 'The old URL stops working immediately. Continue when you are ready to update OBS.',
    how: 'Set up one OBS Browser Source above the video. Paste this URL and set its dimensions to the full base canvas (for example, 1920 × 1080). Under Transform, choose Reset Transform, then Fit to Screen. The ad fills the left 20%, the logo sits at the top right, and the ticker stays at the bottom. Reuse this source in each scene.',
    access: 'Station control permission is required to manage graphics.',
    select: 'Select a station', confirm: 'Delete this graphic from the station?', error: 'The action failed', invalidImage: 'Choose a PNG, JPEG, or WebP image no larger than 512 KB.'
  }
};

const fieldClass = 'mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm';
const buttonClass = 'rounded border border-zinc-700 px-3 py-2 text-xs font-semibold disabled:opacity-50';
const empty = (kind) => ({ kind, content: '', image: '', active: false, expiresAt: null });

function GraphicsSlot({ kind, saved, t, onCommit, path }) {
  const [content, setContent] = useState(saved?.content ?? '');
  const [image, setImage] = useState(saved?.image ?? '');
  const [duration, setDuration] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!saved?.expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [saved?.expiresAt]);

  const active = Boolean(saved?.active) && (!saved.expiresAt || now < saved.expiresAt);
  const dirty = content.trim() !== (saved?.content ?? '') || image !== (saved?.image ?? '');
  const valid = kind === 'logo' ? Boolean(image) : Boolean(content.trim() || image);
  const seconds = active && saved.expiresAt ? Math.max(0, Math.ceil((saved.expiresAt - now) / 1000)) : null;
  const durationValue = Number(duration);
  const validDuration = duration !== '' && Number.isInteger(durationValue) && durationValue >= 0 && durationValue <= 86400;

  async function perform(action) {
    setBusy(true);
    setError('');
    try {
      const target = path + '/' + kind;
      if (action === 'save') {
        const data = { content: content.trim(), image };
        await api(target, { method: 'PUT', body: data });
        onCommit({ ...empty(kind), ...saved, ...data });
      }
      if (action === 'publish') {
        const { expiresAt } = await api(target + '/publish', { method: 'POST', body: { duration: durationValue } });
        setNow(Date.now());
        onCommit({ ...saved, active: true, expiresAt });
      }
      if (action === 'hide') {
        await api(target + '/hide', { method: 'POST' });
        onCommit({ ...saved, active: false, expiresAt: null });
      }
      if (action === 'delete') {
        await api(target, { method: 'DELETE' });
        onCommit(null);
        setContent('');
        setImage('');
        setDuration('0');
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 512 * 1024) return setError(t.invalidImage);
    setError('');
    setBusy(true);
    try {
      setImage(await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }));
    } catch {
      setError(t.invalidImage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t[kind]}</h3>
        <span className={active ? 'text-xs text-emerald-400' : 'text-xs text-zinc-400'}>
          {active ? t.visible : saved?.expiresAt && now >= saved.expiresAt ? t.expired : t.hidden}
          {seconds !== null && ` · ${seconds} ${t.second}`}
        </span>
      </header>
      {kind !== 'logo' && <label className="block text-sm">{t.text}
        <textarea className={fieldClass} value={content} onChange={(event) => setContent(event.target.value)} rows={2} maxLength={kind === 'ad' ? 140 : 600} dir="auto" disabled={busy} />
      </label>}
      {kind !== 'ticker' && <div className="space-y-2">
        <label className="block text-sm">{t.image}
          <input className={fieldClass} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} disabled={busy} />
        </label>
        <p className="text-xs text-zinc-400">{t.imageHelp}</p>
        {image && <div className="flex items-center gap-3">
          <img src={image} alt={t[kind]} className="h-12 w-16 rounded bg-zinc-800 object-contain" />
          <button type="button" disabled={busy} className="text-xs underline" onClick={() => setImage('')}>{t.removeImage}</button>
        </div>}
      </div>}
      {(valid || saved) && <label className="block text-xs">{t.duration}
        <input className={fieldClass} type="number" min="0" max="86400" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} disabled={busy} />
        <span className="mt-1 block text-zinc-400">{t.durationHelp}</span>
      </label>}
      <div className="flex flex-wrap gap-2">
        {dirty && <button className={buttonClass} onClick={() => perform('save')} disabled={busy || !valid}>{t.save}</button>}
        {saved && !dirty && <button className={buttonClass + ' bg-cyan-800 text-white'} onClick={() => perform('publish')} disabled={busy || !validDuration}>{t.publish}</button>}
        {active && <button className={buttonClass} onClick={() => perform('hide')} disabled={busy}>{t.hide}</button>}
        {saved && <button className={buttonClass + ' border-red-800 text-red-300'} disabled={busy} onClick={() => {
          if (window.confirm(t.confirm)) void perform('delete');
        }}>{t.delete}</button>}
      </div>
      {error && <p role="alert" className="text-xs text-red-300">{t.error} · {error}</p>}
    </article>
  );
}

function ObsTextSources({ station, language }) {
  const { setTextInput, setSceneItem, pending } = useMcrStore();
  const [selection, setSelection] = useState('');
  const [text, setText] = useState('');
  const scene = station.scenes.find((item) => item.name === station.currentProgramScene);
  const sources = scene?.sources.filter((source) => /^text_(gdiplus|ft2_source)(?:_v\d+)?$/.test(source.inputKind ?? '')) ?? [];
  if (!station.ready || !sources.length) return null;
  const source = sources.find((item) => String(item.sceneItemId) === selection);
  const disabled = !source || pending[station.id];
  const ar = language === 'ar';
  return <details className="space-y-3 rounded-lg border border-zinc-800 p-4">
    <summary className="cursor-pointer font-semibold">{ar ? 'مصادر النص الموجودة في OBS' : 'Existing OBS text sources'}</summary>
    <label className="block text-sm">{scene.name}
      <select className={fieldClass} value={selection} onChange={(event) => { setSelection(event.target.value); setText(''); }}>
        <option value="">{ar ? 'اختر المصدر' : 'Select a source'}</option>
        {sources.map((item) => <option key={item.sceneItemId} value={item.sceneItemId}>{item.sourceName}</option>)}
      </select>
    </label>
    <label className="block text-sm">{ar ? 'النص الجديد' : 'New text'}
      <textarea className={fieldClass} value={text} maxLength={3000} onChange={(event) => setText(event.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button className={buttonClass} disabled={disabled} onClick={() => {
        if (window.confirm(ar ? 'تعديل النص في مشهد البث؟' : 'Update this text on Program?')) void setTextInput(station.id, source.sourceName, text);
      }}>{ar ? 'تطبيق النص' : 'Apply text'}</button>
      <button className={buttonClass} disabled={disabled} onClick={() => {
        if (window.confirm(ar ? 'تغيير ظهور المصدر على البث؟' : 'Change this source visibility on Program?')) {
          void setSceneItem(station.id, scene.name, source.sceneItemId, !source.sceneItemEnabled);
        }
      }}>{ar ? 'تغيير الظهور' : 'Toggle visibility'}</button>
    </div>
  </details>;
}

function StationGraphics({ stationId, t }) {
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [visibleItems, setVisibleItems] = useState([]);
  const path = stationPath(stationId, '/graphics');

  useEffect(() => {
    const controller = new AbortController();
    api(path, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setConfiguration(data);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [path]);

  useEffect(() => {
    if (!configuration) return;
    function update() {
      setVisibleItems(configuration.items.filter((item) => item.active && (!item.expiresAt || item.expiresAt > Date.now())));
    }
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [configuration]);

  if (error && !configuration) return <p role="alert" className="text-red-300">{t.error} · {error}</p>;
  if (!configuration) return <p role="status">{t.loading}</p>;
  const url = new URL('/broadcast-overlay/' + configuration.token, window.location.origin).href;
  return <>
    <div className="grid gap-4 xl:grid-cols-3">
      {kinds.map((kind) => <GraphicsSlot key={kind} kind={kind} t={t} path={path}
        saved={configuration.items.find((item) => item.kind === kind)}
        onCommit={(item) => setConfiguration((current) => ({
          ...current, items: [...current.items.filter((entry) => entry.kind !== kind), ...(item ? [item] : [])]
        }))} />)}
    </div>
    <div className={visibleItems.length ? 'grid items-start gap-4 lg:grid-cols-2' : undefined}>
      {visibleItems.length > 0 && <section className="rounded-lg border border-zinc-800 p-4">
        <h2 className="mb-3 font-semibold">{t.preview}</h2>
        <div className="relative aspect-video overflow-hidden rounded border border-zinc-700 bg-gradient-to-br from-slate-800 to-zinc-950">
          <OverlayCanvas items={visibleItems} />
        </div>
      </section>}
      <details className="space-y-3 rounded-lg border border-zinc-800 p-4">
        <summary className="cursor-pointer font-semibold">{t.obs}</summary>
        <p className="text-sm text-zinc-400">{t.how}</p>
        <input aria-label={t.obs} className={fieldClass} readOnly value={url} dir="ltr" onFocus={(event) => event.target.select()} />
        <button className={buttonClass} onClick={async () => {
          try { await navigator.clipboard.writeText(url); setCopied(true); }
          catch { setError(t.error); }
        }}>{copied ? t.copied : t.copy}</button>
        <button className={buttonClass} disabled={rotating} onClick={async () => {
          if (!window.confirm(t.rotateConfirm)) return;
          setRotating(true);
          setError('');
          try {
            const { token } = await api(path + '/rotate-link', { method: 'POST' });
            setCopied(false);
            setConfiguration((current) => ({ ...current, token }));
          } catch (failure) {
            setError(failure.message);
          } finally {
            setRotating(false);
          }
        }}>{t.rotate}</button>
        {error && <p role="alert" className="text-red-300">{error}</p>}
      </details>
    </div>
  </>;
}

function IndependentGraphics({ stationId, language }) {
  const status = useProgramStatus(stationId);
  if (!status?.configured) return null;
  return <section className="space-y-3">
    <h2 className="text-base font-semibold">{language === 'ar' ? 'جرافيكس البرنامج المستقل' : 'Independent Program graphics'}</h2>
    <ProgramAds stationId={stationId} language={language} status={status} />
    <ProgramWatermark stationId={stationId} language={language} status={status} />
    <ProgramTicker stationId={stationId} language={language} status={status} />
  </section>;
}

export function GraphicsPage() {
  const { language, stations, selectedStationId, selectStation } = useMcrStore();
  const { permissions } = useOutletContext();
  const t = labels[language] ?? labels.en;
  const canControl = permissions.includes('*') || permissions.includes('station:control');
  const station = stations.find((item) => item.id === selectedStationId);

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <h1 className="text-lg font-bold">{t.title}</h1>
        <label className="text-sm">{t.station}
          <select className={fieldClass} value={station?.id ?? ''} onChange={(event) => selectStation(event.target.value)}>
            {!station && <option value="">{t.select}</option>}
            {stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </header>
      {!canControl && <p className="text-zinc-400">{t.access}</p>}
      {canControl && !station && <p className="text-zinc-400">{t.noStation}</p>}
      {canControl && station && <>
        <IndependentGraphics key={station.id} stationId={station.id} language={language} />
        <details className="space-y-3 rounded-lg border border-zinc-700 p-4">
          <summary className="cursor-pointer font-semibold">{language === 'ar' ? 'جرافيكس OBS' : 'OBS graphics'}</summary>
          <StationGraphics key={station.id} stationId={station.id} t={t} />
          <ObsTextSources key={station.id + ':' + station.currentProgramScene} station={station} language={language} />
        </details>
      </>}
    </section>
  );
}
