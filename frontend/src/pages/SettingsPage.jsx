import React, { useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api, stationPath } from '../context/api.js';
import { useMcrStore } from '../context/useMcrStore.js';
import { translations } from '../i18n/translations.js';
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from '@mcr/ui';
import { Settings, Key, Server, RefreshCw, Copy, Check } from 'lucide-react';

export function SettingsPage() {
  const { language, selectedStationId, stations, synchronize } = useMcrStore();
  const t = translations[language] || translations.en;
  const ar = language === 'ar';
  const [search, setSearch] = useSearchParams();
  const targetId = search.get('pair') || selectedStationId;

  const [pairingCode, setPairingCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [serverHost, setServerHost] = useState(() => {
    const { hostname, port, origin } = window.location;
    return port === '5173' && ['localhost', '127.0.0.1'].includes(hostname) ? 'http://127.0.0.1:4000' : origin;
  });
  const user = useOutletContext();
  const canPair = user.permissions.includes('*') || user.permissions.includes('station:manage');
  const station = stations.find((item) => item.id === targetId);

  const [pairingError, setPairingError] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [codeStationId, setCodeStationId] = useState(null);
  const validServerHost = /^https?:\/\/[a-z0-9.\[\]:-]+\/?$/i.test(serverHost);
  const cliCmd = pairingCode && codeStationId === targetId && validServerHost
    ? `node backend/agent/src/index.js pair --code ${pairingCode} --server "${serverHost.replace(/\/$/, '')}" --start` : '';

  const handleGeneratePairingCode = async () => {
    setGenerating(true);
    setPairingError('');
    setPairingCode('');
    try {
      const result = await api('/pairing/generate', { method: 'POST', body: { stationId: targetId } });
      setPairingCode(result.pairingCode);
      setCodeStationId(targetId);
      setExpiresAt(result.expiresAt);
      setCopied(false);
    } catch (error) {
      setPairingError(error.message);
    } finally {
      setGenerating(false);
    }
  };

  async function saveObsSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = values.get('password');
    setSaving(true);
    setSaved(false);
    setPairingError('');
    try {
      await api(stationPath(targetId), { method: 'PATCH', body: {
        obsPort: Number(values.get('port')), ...(password ? { obsPassword: password } : {})
      } });
      form.elements.password.value = '';
      setPairingCode('');
      setSaved(true);
      await synchronize();
    } catch (error) {
      setPairingError(error.message);
    } finally {
      setSaving(false);
    }
  }

  const handleCopyCli = async () => {
    try {
      await navigator.clipboard.writeText(cliCmd);
      setCopied(true);
    } catch {
      setPairingError(ar ? 'تعذّر النسخ تلقائيًا. حدّد الأمر وانسخه يدويًا.' : 'Clipboard unavailable. Select and copy the command.');
    }
  };

  function downloadStationFile() {
    const profile = { serverUrl: new URL(serverHost).origin, pairingCode, expiresAt };
    const url = URL.createObjectURL(new Blob([JSON.stringify(profile)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'MCR-Station.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-cyan-400" />
          <h1 className="text-base font-bold font-mono text-white uppercase tracking-wide">
            {t.nav.settings}
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Device Pairing Generator */}
        <Card className="border border-zinc-800">
          <CardHeader className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              <CardTitle>{ar ? 'اقتران جهاز OBS' : 'MCR Agent Device Pairing'}</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={handleGeneratePairingCode} disabled={!canPair || !station || generating || saving} className="text-xs">
              <RefreshCw className="w-3.5 h-3.5 me-1" />
              {ar ? 'إنشاء اقتران' : 'Generate pairing'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <select aria-label={ar ? 'المحطة المراد اقترانها' : 'Station to pair'} value={station?.id || ''} disabled={generating || saving}
              onChange={(event) => { setSearch({ pair: event.target.value }); setPairingCode(''); setPairingError(''); setSaved(false); }}
              className="w-full rounded bg-zinc-900 p-2">
              {!station && <option value="">{ar ? 'اختر المحطة' : 'Select station'}</option>}
              {stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {station && <p className="text-xs text-zinc-400">{station.name} · {station.status} · {station.hasPassword
              ? (ar ? 'كلمة مرور OBS محفوظة' : 'OBS password saved')
              : (ar ? 'كلمة مرور OBS غير محفوظة' : 'OBS password is unset')}</p>}
            {pairingError && <p role="alert">{pairingError}</p>}
            <p className="text-xs text-zinc-400">
              {ar ? 'نزّل ملف المحطة وضعه بجانب تطبيق MCR Agent على جهاز OBS، ثم افتح التطبيق قبل انتهاء صلاحية الملف.' : 'Download the station file, place it next to MCR Agent on the OBS computer, and open the app before the file expires.'}
            </p>
            {cliCmd && <Button variant="outline" size="sm" onClick={downloadStationFile}>
              {ar ? 'تنزيل ملف المحطة' : 'Download station file'}
            </Button>}

            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded text-center">
              <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">
                {pairingCode ? `${ar ? 'ينتهي عند' : 'Expires'} ${new Date(expiresAt).toLocaleTimeString()}` : (ar ? 'رمز يُستخدم مرة واحدة' : 'Single-use pairing code')}
              </span>
              <span className="text-3xl font-mono font-black text-amber-400 tracking-widest">
                {pairingCode || '—'}
              </span>
            </div>

            <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded font-mono text-xs flex items-center justify-between">
              <input aria-label={ar ? 'أمر الاقتران' : 'Pairing command'} readOnly value={cliCmd} dir="ltr"
                onFocus={(event) => event.target.select()} className="min-w-0 flex-1 bg-transparent text-zinc-300" />
              <Button variant="ghost" size="sm" onClick={handleCopyCli} disabled={!cliCmd} className="shrink-0 ms-2"
                aria-label={ar ? 'نسخ أمر الاقتران' : 'Copy pairing command'}>
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Network & OBS Defaults */}
        <Card className="border border-zinc-800 md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              <CardTitle>{ar ? 'إعدادات اتصال المحطة' : 'Station connection settings'}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={ar ? 'عنوان خادم MCR للـ Agent' : 'MCR server URL used by the Agent'}
              value={serverHost}
              onChange={(e) => setServerHost(e.target.value)}
              className="font-mono text-xs"
            />
            {canPair && station && <form key={station.id} onSubmit={saveObsSettings} className="space-y-2">
              <Input label={ar ? 'منفذ OBS WebSocket' : 'OBS WebSocket port'} name="port" type="number" min="1" max="65535" required defaultValue={station.obsPort} />
              <Input label={ar ? 'كلمة مرور OBS الجديدة (اختياري)' : 'New OBS password (optional)'} name="password" type="password" autoComplete="new-password" />
              <Button type="submit" size="sm" disabled={saving || generating}>{ar ? 'حفظ إعدادات OBS' : 'Save OBS settings'}</Button>
              {saved && <p role="status" className="text-xs text-emerald-400">{ar ? 'تم الحفظ. أنشئ أمر اقتران جديدًا لتطبيق الإعدادات.' : 'Saved. Generate a new pairing command to apply the settings.'}</p>}
            </form>}
            {!validServerHost && <p role="alert" className="text-red-300">Enter an HTTP or HTTPS server origin.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


