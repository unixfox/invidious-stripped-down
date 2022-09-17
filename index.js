import Koa from 'koa';
import pkg from 'youtubei.js';
const { Innertube, UniversalCache } = pkg;
const app = new Koa();
import Router from '@koa/router';

const router = new Router();
const youtube = await Innertube.create({
  cache: new UniversalCache(
    true,
    './.cache'
  )
});

async function getBasicVideoInfo(videoId) {
  let basicVideoInfo;

  try {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'ANDROID');
  } catch (error) {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'WEB');
  }

  //if (basicVideoInfo.playability_status.reason) {
  //  basicVideoInfo = await youtube.getBasicInfo(videoId, 'TVHTML5_SIMPLY_EMBEDDED_PLAYER');
  //}

  if (basicVideoInfo.streaming_data) {
    basicVideoInfo.streaming_data.adaptive_formats = basicVideoInfo.streaming_data.adaptive_formats
      .filter(i => i.mime_type.includes("audio/mp4" | "video/mp4"));
  }

  return basicVideoInfo;
}

router.get('/api/manifest/dash/id/:videoId', async (ctx, next) => {
  const videoId = ctx.params.videoId;

  try {
    const basicVideoInfo = await getBasicVideoInfo(videoId);
    ctx.body = basicVideoInfo.toDash();
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
    ctx.redirect(selectedItagFormats[0].url)
  } catch (error) {
    ctx.status = 400;
    return ctx.body = "The video can't be played.";
  }
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(process.env.BIND_ADDRESS || "0.0.0.0:3000");