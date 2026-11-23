import React, { useEffect, useState } from 'react';
import { api } from '../context/api.js';
import { useMcrStore } from '../context/useMcrStore.js';

const actions = { scene: 'Switch Program scene', recordingStart: 'Start recording', recordingStop: 'Stop recording' };

export function AutomationPage({ scheduled, title }) {
  const stations = useMcrStore((state) => state.stations);
  const [stationId, setStationId] = useState('');
  const [action, setAction] = useState('scene');
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const station = stations.find((item) => item.id === stationId);

  async function load(signal) {
    try {
      const { data } = await api('/automations', { signal });
      if (!signal?.aborted) setJobs(data.filter((job) => Boolean(job.runAt) === scheduled));
    } catch (failure) {
      if (!signal?.aborted) setError(failure.message);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [scheduled]);

  async function perform(path, body) {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'POST', body });
      await load();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const time = values.get('time');
    void perform('/automations', {
      name: values.get('name'), stationId, action,
      sceneName: action === 'scene' ? values.get('sceneName') : undefined,
      runAt: time ? new Date(time).toISOString() : undefined
    });
  }

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded border border-zinc-800 p-3">
        <label>Name<input className="block rounded bg-zinc-800 p-2" name="name" required maxLength={100} /></label>
        <label>Station<select className="block rounded bg-zinc-800 p-2" value={stationId} onChange={(event) => setStationId(event.target.value)} required>
          <option value="">Select station</option>
          {stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Action<select className="block rounded bg-zinc-800 p-2" value={action} onChange={(event) => setAction(event.target.value)}>
          {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {action === 'scene' && <label>Scene<select className="block rounded bg-zinc-800 p-2" name="sceneName" required>
          <option value="">Select scene</option>
          {station?.scenes.map(({ name }) => <option key={name} value={name}>{name}</option>)}
        </select></label>}
        {scheduled && <label>Run at (local time)<input className="block rounded bg-zinc-800 p-2" type="datetime-local" name="time" required /></label>}
        <button className="rounded bg-cyan-800 px-3 py-2" disabled={busy}>{scheduled ? 'Schedule' : 'Save macro'}</button>
      </form>
      {!jobs.length && <p className="text-sm text-zinc-400">{scheduled ? 'No scheduled jobs.' : 'No saved macros.'}</p>}
      <ul className="space-y-2">
        {jobs.map((job) => <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 p-3">
          <div>
            <strong>{job.name}</strong>
            <p className="text-sm text-zinc-400">{actions[job.action]} {job.sceneName} · {job.status}</p>
            {job.runAt && <time dateTime={job.runAt}>{new Date(job.runAt).toLocaleString()}</time>}
            {job.error && <p className="text-red-300">{job.error}</p>}
          </div>
          {!job.runAt && <button disabled={busy || job.status === 'RUNNING'} className="rounded border border-zinc-700 px-3 py-1" onClick={() => {
            if (window.confirm(`Run "${job.name}" on OBS?`)) void perform('/automations/' + job.id + '/run');
          }}>Run</button>}
          {job.status === 'SCHEDULED' && <button disabled={busy} className="rounded border border-zinc-700 px-3 py-1"
            onClick={() => void perform('/automations/' + job.id + '/cancel')}>Cancel</button>}
        </li>)}
      </ul>
    </section>
  );
}
