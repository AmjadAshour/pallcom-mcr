import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../context/api.js';
import { useMcrStore } from '../context/useMcrStore.js';

export function UsersPermissionsPage() {
  const user = useOutletContext();
  const ar = useMcrStore(state => state.language === 'ar');
  const canManage = user.permissions.includes('*') || user.permissions.includes('user:manage');
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [managedAccount, setManagedAccount] = useState(null);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    api('/users', { signal: controller.signal }).then(({ data }) => setUsers(data))
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [canManage]);

  async function addUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset();
      setUsers((await api('/users')).data);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeAccount(event, target, action) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/users/' + encodeURIComponent(target.id) + '/' + action, {
        method: 'PATCH', body: {
          currentPassword: fields.get('currentPassword'),
          ...(action === 'status' ? { active: !target.isActive } : { role: fields.get('role') })
        }
      });
      setManagedAccount(null);
      setUsers((await api('/users')).data);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">{ar ? 'المستخدمون والصلاحيات' : 'Users and permissions'}</h1>
      <p className="text-sm text-zinc-400">{user.fullName} · {user.role}</p>
      <p className="text-sm text-zinc-400">{user.permissions.includes('*') ? (ar ? 'جميع الصلاحيات' : 'All permissions') : user.permissions.join(', ')}</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {canManage && <>
        <form onSubmit={addUser} className="flex flex-wrap items-end gap-3 rounded border border-zinc-800 p-3">
          <label>{ar ? 'الاسم الكامل' : 'Full name'}<input className="block rounded bg-zinc-800 p-2" name="fullName" required minLength={2} maxLength={120} /></label>
          <label>{ar ? 'البريد الإلكتروني' : 'Email'}<input className="block rounded bg-zinc-800 p-2" name="email" type="email" maxLength={254} required /></label>
          <label>{ar ? 'كلمة المرور الأولية' : 'Initial password'}<input className="block rounded bg-zinc-800 p-2" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
          <label>{ar ? 'الدور' : 'Role'}<select className="block rounded bg-zinc-800 p-2" name="role" defaultValue="VIEWER">
            <option>VIEWER</option><option>OPERATOR</option><option>STUDIO_MANAGER</option>
          </select></label>
          <label>{ar ? 'كلمة مرورك الحالية' : 'Your current password'}<input className="block rounded bg-zinc-800 p-2" name="currentPassword" type="password" autoComplete="current-password" maxLength={4096} required /></label>
          <button disabled={busy} className="rounded bg-cyan-800 px-3 py-2">{ar ? 'إنشاء حساب' : 'Create account'}</button>
        </form>
        <ul className="space-y-2">{users.map((item) => <li key={item.id} className="rounded border border-zinc-800 p-3">
          <strong>{item.fullName}</strong><p className="text-sm text-zinc-400">{item.email} · {item.role} · {item.isActive ? (ar ? 'نشط' : 'Active') : (ar ? 'معطّل' : 'Inactive')}</p>
          {item.id !== user.id && ['STUDIO_MANAGER', 'OPERATOR', 'VIEWER'].includes(item.role) &&
            <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" className="underline" disabled={busy} onClick={() => setManagedAccount({ id: item.id, action: 'status' })}>
              {item.isActive ? (ar ? 'تعطيل الحساب' : 'Deactivate account') : (ar ? 'تفعيل الحساب' : 'Activate account')}
            </button>
            <button type="button" className="underline" disabled={busy} onClick={() => setManagedAccount({ id: item.id, action: 'role' })}>
              {ar ? 'تعديل الدور' : 'Change role'}
            </button></div>}
          {managedAccount?.id === item.id &&
            <form key={managedAccount.action} className="mt-2 flex flex-wrap items-end gap-2"
              onSubmit={(event) => changeAccount(event, item, managedAccount.action)}>
              {managedAccount.action === 'role' && <label>{ar ? 'الدور الجديد' : 'New role'}
                <select className="block rounded bg-zinc-800 p-2" name="role" required defaultValue="">
                  <option value="" disabled>{ar ? 'اختر الدور' : 'Select role'}</option>
                  {['VIEWER', 'OPERATOR', 'STUDIO_MANAGER'].filter(role => role !== item.role)
                    .map(role => <option key={role}>{role}</option>)}
                </select>
              </label>}
              <label>{ar ? 'كلمة مرورك الحالية' : 'Your current password'}
                <input className="block rounded bg-zinc-800 p-2" type="password" name="currentPassword" autoComplete="current-password" maxLength={4096} required />
              </label>
              <button className="rounded bg-cyan-800 px-3 py-2" disabled={busy}>{ar ? 'تأكيد' : 'Confirm'}</button>
              <button type="button" disabled={busy} onClick={() => setManagedAccount(null)}>{ar ? 'إلغاء' : 'Cancel'}</button>
            </form>}
        </li>)}</ul>
      </>}
    </section>
  );
}
