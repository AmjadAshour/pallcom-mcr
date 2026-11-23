import { create } from 'zustand';
import { api, stationPath } from './api.js';

function stationSummary(station) {
  return {
    ...station,
    studioName: station.description || '',
    fps: Number(station.fps) || 0,
    cpuUsage: Number(station.cpuUsage) || 0,
    memoryUsage: Number(station.memoryUsage) || 0,
    scenes: [], audioInputs: [], ready: false,
    streamStatus: 'UNKNOWN', recordStatus: 'UNKNOWN'
  };
}

export const useMcrStore = create((set, get) => {
  let synchronizing = false;
  let sessionVersion = 0;
  let stationListVersion = 0;
  const commandVersions = new Map();

  async function synchronize() {
    if (synchronizing) return;
    synchronizing = true;
    const version = sessionVersion;
    const listVersion = stationListVersion;
    try {
      const { data } = await api('/stations');
      if (version !== sessionVersion || listVersion !== stationListVersion) return;
      const previous = get().stations;
      const currentId = get().selectedStationId;
      const selectedStationId = data.some((station) => station.id === currentId) ? currentId : data[0]?.id;
      const stations = data.map((value) => {
        const station = stationSummary(value);
        const last = previous.find((item) => item.id === station.id);
        return last && station.status === 'ONLINE'
          ? { ...last, status: station.status, name: station.name, fps: station.fps,
            cpuUsage: station.cpuUsage, memoryUsage: station.memoryUsage, lastHeartbeat: station.lastHeartbeat,
            hasPassword: station.hasPassword, obsPort: station.obsPort }
          : station;
      });
      set({ stations, selectedStationId, connectionError: '' });
      await Promise.all(stations.filter((station) => station.status === 'ONLINE').map(async (station) => {
        const commandVersion = commandVersions.get(station.id);
        try {
          const { data: snapshot } = await api(stationPath(station.id, '/snapshot'));
          if (version !== sessionVersion || commandVersion !== commandVersions.get(station.id) || get().pending[station.id]) return;
          set((state) => ({
            stations: state.stations.map((item) => item.id === station.id ? { ...item, ...snapshot, ready: true } : item)
          }));
        } catch {
          if (version !== sessionVersion || commandVersion !== commandVersions.get(station.id) || get().pending[station.id]) return;
          set((state) => ({
            stations: state.stations.map((item) => item.id === station.id
              ? { ...item, ready: false, streamStatus: 'UNKNOWN', recordStatus: 'UNKNOWN' }
              : item)
          }));
        }
      }));
    } catch (error) {
      if (version !== sessionVersion) return;
      set({
        connectionError: error.message,
        stations: get().stations.map((station) => ({ ...station, ready: false, streamStatus: 'UNKNOWN', recordStatus: 'UNKNOWN' }))
      });
    } finally {
      synchronizing = false;
    }
  }

  async function send(id, route, body) {
    const station = get().stations.find((item) => item.id === id);
    if (!station?.ready || get().pending[id]) return;
    const version = sessionVersion;
    commandVersions.set(id, (commandVersions.get(id) ?? 0) + 1);
    set((state) => ({ commandError: '', pending: { ...state.pending, [id]: true } }));
    try {
      await api(stationPath(id, route), { method: 'POST', body });
      const { data: snapshot } = await api(stationPath(id, '/snapshot'));
      if (version !== sessionVersion) return;
      set((state) => ({
        stations: state.stations.map((item) => item.id === id ? { ...item, ...snapshot, ready: true } : item)
      }));
    } catch (error) {
      if (version !== sessionVersion) return;
      set((state) => ({
        commandError: error.message,
        stations: state.stations.map((item) => item.id === id
          ? { ...item, ready: false, streamStatus: 'UNKNOWN', recordStatus: 'UNKNOWN' }
          : item)
      }));
    } finally {
      if (version === sessionVersion) {
        commandVersions.set(id, commandVersions.get(id) + 1);
        set((state) => ({ pending: { ...state.pending, [id]: false } }));
      }
    }
  }

  return {
    language: 'en', theme: 'dark', stations: [], pending: {}, selectedStationId: null,
    tBarPosition: 0, multiviewLayout: 'grid2x2', commandError: '', connectionError: '',
    synchronize,
    deleteStation: async (id) => {
      if (get().pending[id]) return;
      const version = sessionVersion;
      set((state) => ({ pending: { ...state.pending, [id]: true } }));
      try {
        await api(stationPath(id), { method: 'DELETE' });
        if (version !== sessionVersion) return;
        stationListVersion++;
        set((state) => {
          const stations = state.stations.filter((station) => station.id !== id);
          return {
            stations,
            selectedStationId: state.selectedStationId === id ? stations[0]?.id ?? null : state.selectedStationId
          };
        });
      } finally {
        if (version === sessionVersion) {
          set((state) => ({ pending: { ...state.pending, [id]: false } }));
        }
      }
    },
    resetSession: () => {
      sessionVersion++;
      commandVersions.clear();
      set({ stations: [], selectedStationId: null, pending: {}, connectionError: '', commandError: '' });
    },
    setLanguage: (lang) => {
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = lang;
      set({ language: lang });
    },
    toggleTheme: () => {
      const theme = get().theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', theme === 'dark');
      set({ theme });
    },
    selectStation: (selectedStationId) => set({ selectedStationId, tBarPosition: 0 }),
    setMultiviewLayout: (multiviewLayout) => set({ multiviewLayout }),

    switchProgramScene: (id, sceneName) => send(id, '/scenes/switch', { sceneName }),
    switchPreviewScene: (id, sceneName) => send(id, '/scenes/switch', { sceneName, preview: true }),
    triggerCut: () => {
      const id = get().selectedStationId;
      const scene = get().stations.find((item) => item.id === id)?.currentPreviewScene;
      if (scene) return send(id, '/scenes/cut', { sceneName: scene });
    },
    triggerAutoTransition: () => send(get().selectedStationId, '/studio-mode/transition'),
    setStudioMode: (id, enabled) => send(id, '/studio-mode', { enabled }),
    setTransitionType: (id, transitionName) => send(id, '/transition-type', { transitionName }),
    setTransitionDuration: (id, transitionDuration) => send(id, '/transition-duration', { transitionDuration }),
    setTextInput: (id, inputName, text) => send(id, '/text-input', { inputName, text }),
    setTBarPosition: (position) => set({ tBarPosition: position }),
    releaseTBar: async () => {
      const { selectedStationId, tBarPosition } = get();
      await send(selectedStationId, '/studio-mode/t-bar', { position: tBarPosition / 100, release: true });
      if (selectedStationId === get().selectedStationId && tBarPosition === 100) set({ tBarPosition: 0 });
    },
    triggerEmergencyCut: () => {
      const id = get().selectedStationId;
      const scene = get().stations.find((item) => item.id === id)?.scenes.find((item) => item.name === 'Emergency Slate / Standby');
      if (!scene) return set({ commandError: 'The selected station has no Emergency Slate / Standby scene.' });
      if (window.confirm('Switch the selected station to its emergency scene?')) return send(id, '/scenes/cut', { sceneName: scene.name });
    },
    toggleStream: (id) => {
      const active = get().stations.find((item) => item.id === id)?.streamStatus === 'STREAMING';
      if (!active || window.confirm('Stop the live broadcast on this station?')) return send(id, active ? '/stream/stop' : '/stream/start');
    },
    toggleRecord: (id) => {
      const active = get().stations.find((item) => item.id === id)?.recordStatus === 'RECORDING';
      return send(id, active ? '/record/stop' : '/record/start');
    },
    setInputVolume: (id, inputName, inputVolumeMul) => send(id, '/audio/volume', { inputName, inputVolumeMul }),
    setInputMute: (id, inputName, inputMuted) => send(id, '/audio/mute', { inputName, inputMuted }),
    setSceneItem: (id, sceneName, sceneItemId, enabled) => send(id, '/scene-item', { sceneName, sceneItemId, enabled })
  };
});


