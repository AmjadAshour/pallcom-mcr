import React, { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@mcr/ui';
import { api } from '../context/api.js';
import { TwoFactorSettings } from './TwoFactorSettings.jsx';

export function AccountSettings({ user, language }) {
  const ar = language === 'ar';
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api('/auth/sessions', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSessions(result.data); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);

  async function perform(action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function saveProfile(event) {
    event.preventDefault();
    const fullName = new FormData(event.currentTarget).get('fullName');
    void perform(async () => {
      const result = await api('/auth/me', { method: 'PATCH', body: { fullName } });
      user.updateUser(result.user);
      setMessage(ar ? 'تم حفظ الاسم.' : 'Name saved.');
    });
  }

  function savePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    void perform(async () => {
      await api('/auth/password', { method: 'POST', body });
      form.reset();
      user.clearSession();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>{ar ? 'الحساب والجلسات' : 'Account and sessions'}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {message && <p role="status" className="text-emerald-300">{message}</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={saveProfile}>
          <label className="space-y-1">{ar ? 'الاسم الظاهر' : 'Display name'}
            <Input name="fullName" defaultValue={user.fullName} required minLength={2} maxLength={120} autoComplete="name" />
          </label>
          <Button disabled={busy}>{ar ? 'حفظ الاسم' : 'Save name'}</Button>
        </form>
        <form className="flex flex-wrap items-end gap-2" onSubmit={savePassword}>
          <label className="space-y-1">{ar ? 'كلمة المرور الحالية' : 'Current password'}
            <Input name="currentPassword" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" maxLength={4096} />
          </label>
          <label className="space-y-1">{ar ? 'كلمة مرور جديدة (12 حرفًا على الأقل)' : 'New password (at least 12 characters)'}
            <Input name="newPassword" type={showPassword ? 'text' : 'password'} required minLength={12} maxLength={128} autoComplete="new-password" />
          </label>
          <Button type="button" variant="outline" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'إظهار' : 'Show')}
          </Button>
          <Button disabled={busy}>{ar ? 'تغيير كلمة المرور' : 'Change password'}</Button>
        </form>
        <p className="text-sm text-zinc-400">{ar ? 'تغيير كلمة المرور ينهي جميع الجلسات.' : 'Changing your password signs you out of all sessions.'}</p>
        <h3 className="font-medium">{ar ? 'الجلسات النشطة' : 'Active sessions'}</h3>
        {sessions && <ul className="space-y-2">{sessions.map(session =>
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{session.current ? (ar ? 'هذه الجلسة' : 'This session') : (ar ? 'جلسة أخرى' : 'Other session')}
              {' · '}{ar ? 'تنتهي' : 'Expires'} {new Date(session.expiresAt).toLocaleString(language)}
            </span>
            <Button variant="outline" disabled={busy} onClick={() => perform(async () => {
              await api('/auth/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' });
              if (session.current) user.clearSession();
              else setSessions(previous => previous.filter(item => item.id !== session.id));
            })}>{ar ? 'إنهاء الجلسة' : 'End session'}</Button>
          </li>
        )}</ul>}
        <TwoFactorSettings ar={ar} clearSession={user.clearSession} />
      </CardContent>
    </Card>
  );
}
