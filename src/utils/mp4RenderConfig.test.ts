import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFfmpegRenderArgs,
  getMp4DownloadFilename,
  mapLangToIso639_2,
  normalizeSubtitleRenderMode,
} from './mp4RenderConfig.ts';

test('normalizeSubtitleRenderMode and getMp4DownloadFilename handle all three modes', () => {
  assert.equal(normalizeSubtitleRenderMode('hardsub'), 'hardsub');
  assert.equal(normalizeSubtitleRenderMode('softsub'), 'softsub');
  assert.equal(normalizeSubtitleRenderMode('dubbing_only'), 'dubbing_only');
  assert.equal(normalizeSubtitleRenderMode('unknown'), 'hardsub');

  assert.equal(getMp4DownloadFilename('video.mp4', 'hardsub'), 'video_dubbing_hardsub.mp4');
  assert.equal(getMp4DownloadFilename('video.mp4', 'softsub'), 'video_dubbing_softsub.mp4');
  assert.equal(getMp4DownloadFilename('video.mp4', 'dubbing_only'), 'video_dubbing_only.mp4');
  assert.equal(mapLangToIso639_2('id'), 'ind');
  assert.equal(mapLangToIso639_2('ja'), 'jpn');
  assert.equal(mapLangToIso639_2('xx'), 'und');
});

test('buildFfmpegRenderArgs configures hardsub, softsub (mov_text), and dubbing_only accurately', () => {
  const hardsubArgs = buildFfmpegRenderArgs({
    mediaFilePath: '/tmp/in.mp4',
    hasVideoStream: true,
    hasMediaAudioStream: true,
    dubAudioFilePath: '/tmp/dub.wav',
    audioMixMode: 'dubbed_only',
    subtitleMode: 'hardsub',
    hasAssFile: true,
    durationSeconds: 16,
    outputPath: '/tmp/out.mp4',
  });
  assert.ok(hardsubArgs.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2,ass=subtitles.ass'));
  assert.ok(!hardsubArgs.includes('mov_text'));
  assert.ok(hardsubArgs.includes('-shortest'));

  const softsubArgs = buildFfmpegRenderArgs({
    mediaFilePath: '/tmp/in.mp4',
    hasVideoStream: true,
    hasMediaAudioStream: true,
    dubAudioFilePath: '/tmp/dub.wav',
    audioMixMode: 'dubbed_with_bg',
    subtitleMode: 'softsub',
    hasAssFile: false,
    srtFilePath: '/tmp/subtitles.srt',
    subtitleLanguageIso: 'ind',
    durationSeconds: 16,
    outputPath: '/tmp/out.mp4',
  });
  assert.ok(softsubArgs.includes('-filter_complex'));
  const filterStr = softsubArgs[softsubArgs.indexOf('-filter_complex') + 1];
  assert.ok(!filterStr.includes('ass=subtitles.ass'));
  assert.ok(softsubArgs.includes('mov_text'));
  assert.ok(softsubArgs.includes('language=ind'));
  assert.ok(softsubArgs.includes('2:s:0'));
  assert.ok(softsubArgs.includes('-t'));
  assert.ok(!softsubArgs.includes('-shortest'));

  const dubbingOnlyArgs = buildFfmpegRenderArgs({
    mediaFilePath: '/tmp/in.mp4',
    hasVideoStream: true,
    hasMediaAudioStream: true,
    dubAudioFilePath: '/tmp/dub.wav',
    audioMixMode: 'dubbed_only',
    subtitleMode: 'dubbing_only',
    hasAssFile: true,
    srtFilePath: '/tmp/subtitles.srt',
    durationSeconds: 16,
    outputPath: '/tmp/out.mp4',
  });
  assert.ok(dubbingOnlyArgs.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2'));
  assert.ok(!dubbingOnlyArgs.some((a) => a.includes('ass=subtitles.ass')));
  assert.ok(!dubbingOnlyArgs.includes('mov_text'));
});
