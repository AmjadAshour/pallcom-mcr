import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../context/api.js';
import { pollWhileVisible } from '../../context/pollWhileVisible.js';
import { useMcrStore } from '../../context/useMcrStore.js';

export function SessionGate({ children }) {
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [needsFactor, setNeedsFactor] = useState(false);
  const [notice, setNotice] = useState('');
  const [resetToken, setResetToken] = useState(() => /^#reset=([a-zA-Z0-9_-]{43})$/.exec(window.location.hash)?.[1]);
  const synchronize = useMcrStore((state) => state.synchronize);
  const resetSession = useMcrStore((state) => state.resetSession);
  const ar = useMcrStore((state) => state.language === 'ar');

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function loadSession() {
      try {
        const { user } = await api('/auth/me', { signal: controller.signal });
        if (!controller.signal.aborted) setUser(user);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure.status === 429) {
          timer = setTimeout(loadSession, failure.retryAfterMs);
          return;
        }
        if (failure.status !== 401) setError(failure.message);
        setUser(null);
      }
    }
    void loadSession();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!user) return;
    return pollWhileVisible(synchronize, 5000);
  }, [user, synchronize]);

  useEffect(() => {
    if (resetToken) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, [resetToken]);

  useEffect(() => {
    if (user !== null) return;
    const controller = new AbortController();
    api('/auth/recovery', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setRecoveryEnabled(result.enabled);
    }).catch(() => {});
    return () => controller.abort();
  }, [user]);

  async function login(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await api('/auth/login', {
        method: 'POST', body: {
          email: fields.get('email'), password: fields.get('password'),
          ...(needsFactor ? { secondFactor: fields.get('secondFactor').trim() } : {})
        }
      });
      setNeedsFactor(false);
      setUser(result.user);
    } catch (failure) {
      if (failure.details === 'second-factor-required') setNeedsFactor(true);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      clearSession();
    } catch (failure) {
      setError(failure.message);
    }
  }

  const clearSession = useCallback(() => {
    resetSession();
    setUser(null);
    setNeedsFactor(false);
  }, [resetSession]);

  async function recover(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (resetToken) {
        await api('/auth/password/reset', { method: 'POST', body: { token: resetToken, newPassword: fields.get('newPassword') } });
        clearSession();
        setResetToken(undefined);
        setNotice(ar ? 'تم تغيير كلمة المرور. سجّل الدخول بالكلمة الجديدة.' : 'Password changed. Sign in with the new password.');
      } else {
        await api('/auth/password/forgot', { method: 'POST', body: { email: fields.get('email') } });
        setForgot(false);
        setNotice(ar ? 'إذا كان الحساب مؤهلًا، سيصلك رابط لاستعادة كلمة المرور.' : 'If the account is eligible, a password reset link will be sent.');
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (user === undefined && !resetToken) return <p role="status" className="p-6 text-zinc-100">Connecting to MCR PRO…</p>;
  if (user && !resetToken) return children({ user, logout, error, updateUser: setUser, clearSession });

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 p-4 text-zinc-100">
      <form key={resetToken ? 'reset' : forgot ? 'forgot' : 'login'} onSubmit={forgot || resetToken ? recover : login}
        className="w-full max-w-sm space-y-4 rounded border border-zinc-800 p-6">
        <h1 className="text-xl font-bold">{resetToken || forgot ? (ar ? 'استعادة كلمة المرور' : 'Password recovery') : 'MCR PRO'}</h1>
        {!resetToken && <label className="block">{ar ? 'البريد الإلكتروني' : 'Email'}<input required autoComplete="username" name="email" type="email" className="mt-1 w-full rounded bg-zinc-800 p-2" /></label>}
        {!forgot && !resetToken && <label className="block">{ar ? 'كلمة المرور' : 'Password'}<input required autoComplete="current-password" name="password" type="password" className="mt-1 w-full rounded bg-zinc-800 p-2" /></label>}
        {!forgot && !resetToken && needsFactor &&
          <label className="block">{ar ? 'رمز التحقق أو رمز الاسترداد' : 'Verification or recovery code'}
            <input required autoComplete="one-time-code" name="secondFactor" maxLength={16} className="mt-1 w-full rounded bg-zinc-800 p-2" />
          </label>}
        {resetToken && <label className="block">{ar ? 'كلمة المرور الجديدة (12 حرفًا على الأقل)' : 'New password (at least 12 characters)'}
          <input required autoComplete="new-password" name="newPassword" type="password" minLength={12} maxLength={128} className="mt-1 w-full rounded bg-zinc-800 p-2" />
        </label>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {notice && <p role="status" className="text-emerald-300">{notice}</p>}
        <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50">
          {resetToken ? (ar ? 'حفظ كلمة المرور' : 'Save password') : forgot ? (ar ? 'إرسال رابط الاستعادة' : 'Send reset link') : (ar ? 'تسجيل الدخول' : 'Sign in')}
        </button>
        {(recoveryEnabled || resetToken) && <button type="button" className="ms-3 underline" disabled={busy} onClick={() => {
          setForgot(!resetToken && !forgot);
          setResetToken(undefined);
          setNeedsFactor(false);
          setError('');
          setNotice('');
        }}>{forgot || resetToken ? (ar ? 'رجوع' : 'Back') : (ar ? 'نسيت كلمة المرور؟' : 'Forgot password?')}</button>}
      </form>
    </main>
  );
}
