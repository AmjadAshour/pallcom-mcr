import React, { useEffect, useState } from 'react';
import { api } from '../../context/api.js';
import { pollWhileVisible } from '../../context/pollWhileVisible.js';
import { useMcrStore } from '../../context/useMcrStore.js';

export function SessionGate({ children }) {
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const synchronize = useMcrStore((state) => state.synchronize);
  const resetSession = useMcrStore((state) => state.resetSession);

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

  async function login(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await api('/auth/login', {
        method: 'POST', body: { email: fields.get('email'), password: fields.get('password') }
      });
      setUser(result.user);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      resetSession();
      setUser(null);
    } catch (failure) {
      setError(failure.message);
    }
  }

  if (user === undefined) return <p role="status" className="p-6 text-zinc-100">Connecting to MCR PRO…</p>;
  if (user) return children({ user, logout, error });

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 p-4 text-zinc-100">
      <form onSubmit={login} className="w-full max-w-sm space-y-4 rounded border border-zinc-800 p-6">
        <h1 className="text-xl font-bold">MCR PRO</h1>
        <label className="block">Email<input required autoComplete="username" name="email" type="email" className="mt-1 w-full rounded bg-zinc-800 p-2" /></label>
        <label className="block">Password<input required autoComplete="current-password" name="password" type="password" className="mt-1 w-full rounded bg-zinc-800 p-2" /></label>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <button disabled={busy} className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
