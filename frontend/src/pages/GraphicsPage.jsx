import React from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useMcrStore } from '../context/useMcrStore.js';
import { useProgramStatus } from '../context/useProgramStatus.js';
import { ProgramAds } from '../components/ProgramAds.jsx';
import { ProgramWatermark } from '../components/ProgramWatermark.jsx';
import { ProgramTicker } from '../components/ProgramTicker.jsx';

const labels = {
  ar: {
    title: 'الجرافيكس والشريط', station: 'محطة البث', noStation: 'أضف محطة بث لبدء إعداد الجرافيكس.',
    access: 'تحتاج إلى صلاحية التحكم بالمحطة لإدارة الجرافيكس.',
    select: 'اختر محطة'
  },
  en: {
    title: 'Broadcast graphics', station: 'Broadcast station', noStation: 'Add a station to configure its graphics.',
    access: 'Station control permission is required to manage graphics.',
    select: 'Select a station'
  }
};

const fieldClass = 'mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm';
function IndependentGraphics({ stationId, language }) {
  const status = useProgramStatus(stationId);
  if (!status) return null;
  if (!status.configured) return <p className="text-sm text-zinc-400">
    {language === 'ar' ? 'فعّل خرج البرنامج لهذه المحطة من ' : 'Enable Program for this station in '}
    <Link className="text-cyan-300 underline" to="/live">{language === 'ar' ? 'التحكم المباشر' : 'Live Control'}</Link>.
  </p>;
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
      {canControl && station &&
        <IndependentGraphics key={station.id} stationId={station.id} language={language} />}
    </section>
  );
}
