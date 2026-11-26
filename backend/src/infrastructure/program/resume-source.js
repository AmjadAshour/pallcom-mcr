import { setTimeout as sleep } from 'node:timers/promises';
import { getSqliteDatabase } from '../database/sqlite.js';
import { programAction, programStatus, takeLocalScene } from './supervisor.js';

function savedSelection(id) {
  return getSqliteDatabase().prepare('SELECT selection FROM program_resume_source WHERE stationId=?').get(id)?.selection;
}

export function rememberProgramSource(id, selection) {
  getSqliteDatabase().prepare('INSERT OR REPLACE INTO program_resume_source VALUES (?,?)')
    .run(id, JSON.stringify(selection));
}

export async function takeSavedScene(id, settings, fade = false) {
  if (settings.type === 'network') {
    const action = settings.input === 'secondary' ? 'obs2' : 'obs';
    return programAction(id, fade ? action + '-fade' : action);
  }
  const db = getSqliteDatabase();
  const frame = db.prepare('SELECT data FROM ad_frames WHERE stationId=? AND asset=? AND frame=?');
  const video = db.prepare("SELECT frames FROM ad_assets WHERE stationId=? AND id=? AND kind='video'").get(id, settings.video);
  const image = settings.image && frame.get(id, settings.image, 0);
  if (!video?.frames || (settings.image && !image) || !frame.get(id, settings.video, 0)) {
    throw Object.assign(new Error('A scene asset is unavailable'), { statusCode:409 });
  }
  const audio = db.prepare('SELECT pcm FROM ad_asset_audio WHERE stationId=? AND asset=?').get(id, settings.video);
  return takeLocalScene(settings, video.frames, image?.data,
    index => frame.get(id, settings.video, index)?.data, audio?.pcm, fade);
}

export async function restoreProgramSource(id, session) {
  const snapshot = savedSelection(id);
  if (!snapshot) return 'slate';
  const selection = JSON.parse(snapshot);
  if (selection.source === 'fallback') return 'slate';
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    const current = programStatus(id);
    if (current.session !== session || current.state !== 'running' || current.source !== 'fallback' ||
        savedSelection(id) !== snapshot) return 'cancelled';
    if (selection.source === 'scene' && selection.scene.type !== 'network') {
      await takeSavedScene(id, selection.scene);
      return 'restored';
    }
    const input = selection.source === 'obs2' || selection.scene?.input === 'secondary' ? 'obs2' : 'obs';
    if (current[input] === 'ready') {
      await programAction(id, input);
      return 'restored';
    }
    await sleep(250);
  }
  return 'unavailable';
}
