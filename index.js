import Koa from 'koa';
import pkg from 'youtubei.js';
const { Innertube, UniversalCache } = pkg;
import Keyv from 'keyv';
const app = new Koa();
import Router from '@koa/router';

const router = new Router();
const youtube = await Innertube.create();

const hostproxy = process.env.HOST_PROXY;

const keyv = new Keyv(process.env.KEYV_ADDRESS || undefined);
const timeExpireCache = 1000 * 60 * 60 * 1;

async function getBasicVideoInfo(videoId) {
  let basicVideoInfo = await keyv.get(videoId);

  if (basicVideoInfo)
    return basicVideoInfo;

  try {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'ANDROID');
  } catch (error) {
    await keyv.set(videoId, {playability_status: {status: "The video can't be played."}}, timeExpireCache);
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'WEB');
  }

  //if (basicVideoInfo.playability_status.reason) {
  //  basicVideoInfo = await youtube.getBasicInfo(videoId, 'TVHTML5_SIMPLY_EMBEDDED_PLAYER');
  //}

  if (basicVideoInfo.streaming_data) {
    basicVideoInfo.streaming_data.adaptive_formats = basicVideoInfo.streaming_data.adaptive_formats
      .filter(i => i.mime_type.includes("audio/mp4" | "video/mp4"));
  }

  await keyv.set(videoId, basicVideoInfo, timeExpireCache);

  return basicVideoInfo;
}

router.get('/api/manifest/dash/id/:videoId', async (ctx, next) => {
  const videoId = ctx.params.videoId;

  try {
    const basicVideoInfo = await getBasicVideoInfo(videoId);
    ctx.body = basicVideoInfo.toDash((url) => {
      url.host = url.host.split('.').slice(0, -2).join('.') + hostproxy;
      return url;
    });
    if (basicVideoInfo.playability_status.status !== "OK") {
      throw ("The video can't be played.");
    }
  } catch (error) {
    ctx.status = 400;
    return ctx.body = "The video can't be played.";
  }
});

router.get('/latest_version', async (ctx, next) => {
  const videoId = ctx.query.id;
  const itagId = ctx.query.itag;

  if (!videoId || !itagId) {
    return ctx.body = "Please specify the itag and video ID";
  }

  try {
    const basicVideoInfo = await getBasicVideoInfo(videoId);
    if (basicVideoInfo.playability_status.status !== "OK") {
      throw ("The video can't be played.");
    }
    const selectedItagFormats = basicVideoInfo.streaming_data.formats.filter(i => i.itag == itagId);
    if (selectedItagFormats.length === 0) {
      ctx.status = 400;
      return ctx.body = "No itag found.";
    }
    let urlToRedirect = new URL(selectedItagFormats[0].url);
    urlToRedirect.host = urlToRedirect.host.split('.').slice(0, -2).join('.') + hostproxy;
    ctx.redirect(urlToRedirect)
  } catch (error) {
    ctx.status = 400;
    return ctx.body = "The video can't be played.";
  }
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(process.env.BIND_PORT || "3000", process.env.BIND_ADDRESS || "0.0.0.0");