import { PROGRAM_SCENE_UPLOAD } from '@mcr/shared';
import { api } from './api.js';

export function programVideoUrl(root, asset) {
  return '/api/v1' + root + '/ads/assets/' + encodeURIComponent(asset) + '/media';
}

export async function uploadProgramVideo(root, file, language) {
  if (file.size > PROGRAM_SCENE_UPLOAD.maxMib * 1024 ** 2) {
    throw new Error(language === 'ar' ? 'حجم الفيديو يتجاوز حد الرفع.' : 'Video exceeds the upload limit.');
  }
  const { data } = await api(root + '/local-scene/video?name=' + encodeURIComponent(file.name.slice(0, 100)), {
    method: 'POST', body: new Blob([file], { type: 'video/mp4' })
  });
  return data;
}
