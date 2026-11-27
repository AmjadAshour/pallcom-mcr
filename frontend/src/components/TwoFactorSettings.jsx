import React, { useEffect, useState } from 'react';
import { Button, Input } from '@mcr/ui';
import { api } from '../context/api.js';

export function TwoFactorSettings({ ar, clearSession }) {
  const [enabled, setEnabled] = useState(null);
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api('/auth/mfa', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setEnabled(result.enabled);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (body.secondFactor) body.secondFactor = body.secondFactor.trim();
    const action = enabled ? 'disable' : secret ? 'confirm' : 'enroll';
    setBusy(true);
    setError('');
    try {
      const result = await api('/auth/mfa/' + action, { method: 'POST', body });
      form.reset();
      if (action === 'disable') clearSession();
      if (action === 'enroll') setSecret(result.secret);
      if (action === 'confirm') {
        setSecret('');
        setCodes(result.recoveryCodes);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 border-t border-zinc-800 pt-3">
      <h3 className="font-medium">{ar ? 'التحقق بخطوتين' : 'Two-factor authentication'}</h3>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {codes.length > 0 ? <>
        <p>{ar ? 'احفظ رموز الاسترداد الآن. كل رمز صالح لمرة واحدة.' : 'Save these recovery codes now. Each code can be used once.'}</p>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2" dir="ltr">
          {codes.map(code => <li key={code} className="font-mono">{code}</li>)}
        </ul>
        <Button onClick={clearSession}>{ar ? 'تم الحفظ، إعادة تسجيل الدخول' : 'Saved, sign in again'}</Button>
      </> : enabled !== null && <>
        {secret && <p>{ar ? 'أضف هذا المفتاح يدويًا في تطبيق المصادقة ثم أدخل الرمز.' : 'Enter this setup key in your authenticator, then enter its code.'}
          {' '}<code dir="ltr" className="break-all">{secret}</code>
        </p>}
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label>{ar ? 'كلمة المرور الحالية' : 'Current password'}
            <Input name="currentPassword" type="password" required autoComplete="current-password" maxLength={4096} />
          </label>
          {(enabled || secret) && <label>{ar ? 'رمز التحقق' : 'Verification code'}
            <Input name="secondFactor" required minLength={6} maxLength={enabled ? 16 : 6} autoComplete="one-time-code" />
          </label>}
          <Button disabled={busy}>{enabled ? (ar ? 'تعطيل التحقق بخطوتين' : 'Disable two-factor authentication')
            : secret ? (ar ? 'تأكيد الإعداد' : 'Verify setup') : (ar ? 'بدء الإعداد' : 'Set up two-factor authentication')}</Button>
        </form>
      </>}
    </section>
  );
}
