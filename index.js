import Koa from 'koa';
import pkg from 'youtubei.js';
const { Innertube } = pkg;
import Keyv from 'keyv';
const app = new Koa();
import Router from '@koa/router';
import dns from 'dns';
import KeyvBrotli from '@keyv/compress-brotli';

dns.setDefaultResultOrder(process.env.DNS_ORDER || 'verbatim');

const router = new Router();
const youtube = await Innertube.create();

const hostproxy = process.env.HOST_PROXY;

const keyv = new Keyv(process.env.KEYV_ADDRESS || undefined, { compression: new KeyvBrotli() });
const timeExpireCache = 1000 * 60 * 60 * 1;

async function getBasicVideoInfo(videoId) {
  let basicVideoInfo = await keyv.get(videoId);

  if (basicVideoInfo)
    return basicVideoInfo;

  try {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'ANDROID');
  } catch (error) {
    await keyv.set(videoId, { playability_status: { status: "The video can't be played: " + videoId } }, timeExpireCache);
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'WEB');
  }

  if (basicVideoInfo.playability_status.reason) {
    basicVideoInfo = await youtube.getBasicInfo(videoId, 'TV_EMBEDDED');
  }

  if (basicVideoInfo.streaming_data) {
    basicVideoInfo.streaming_data.adaptive_formats = basicVideoInfo.streaming_data.adaptive_formats
      .filter(i => i.mime_type.includes("audio/mp4" | "video/mp4"));

    let adaptive_formats = [];
    let formats = [];
  
    for (let format of basicVideoInfo.streaming_data.adaptive_formats) {
      if (format.signature_cipher)
        format.url = format.decipher(youtube.session.player)
      adaptive_formats.push(format);
    }

    for (let format of basicVideoInfo.streaming_data.formats) {
      if (format.signature_cipher)
        format.url = format.decipher(youtube.session.player)
      formats.push(format);
    }
  
    basicVideoInfo.streaming_data.adaptive_formats = adaptive_formats;
    basicVideoInfo.streaming_data.formats = formats;
    
    basicVideoInfo.streaming_data.dashFile = basicVideoInfo.toDash((url) => {
      url.host = url.host.split('.').slice(0, -2).join('.') + hostproxy;
      return url;
    });
  }

  await keyv.set(videoId, (({ streaming_data, playability_status }) => ({ streaming_data, playability_status }))(basicVideoInfo), timeExpireCache);

  return basicVideoInfo;
}

router.get('/api/manifest/dash/id/:videoId', async (ctx, next) => {
  const videoId = ctx.params.videoId;
  ctx.set("access-control-allow-origin", "*");

  try {
    const basicVideoInfo = await getBasicVideoInfo(videoId);
    if (basicVideoInfo.playability_status.status !== "OK") {
      throw ("The video can't be played: " + videoId);
    }
    ctx.set("content-type", "application/dash+xml");
    ctx.body = basicVideoInfo.streaming_data.dashFile;
  } catch (error) {
    ctx.status = 400;
    return ctx.body = "The video can't be played: " + videoId;
  }
});

router.get('/latest_version', async (ctx, next) => {
  const videoId = ctx.query.id;
  const itagId = ctx.query.itag;
  ctx.set("access-control-allow-origin", "*");

  if (!videoId || !itagId) {
    return ctx.body = "Please specify the itag and video ID";
  }

  try {
    const basicVideoInfo = await getBasicVideoInfo(videoId);
    if (basicVideoInfo.playability_status.status !== "OK") {
      throw ("The video can't be played: " + videoId);
    }
    const selectedItagFormats = basicVideoInfo.streaming_data.formats.filter(i => i.itag == itagId);
    if (selectedItagFormats.length === 0) {
      ctx.status = 400;
      return ctx.body = "No itag found.";
    }
    if (!selectedItagFormats[0].url) {
      throw ("No URL, the video can't be played: " + videoId);
    }
    let urlToRedirect = new URL(selectedItagFormats[0].url);
    urlToRedirect.host = urlToRedirect.host.split('.').slice(0, -2).join('.') + hostproxy;
    ctx.redirect(urlToRedirect)
  } catch (error) {
    console.log(error)
    ctx.status = 400;
    return ctx.body = "The video can't be played: " + videoId;
  }
});

app
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(process.env.BIND_PORT || "3000", process.env.BIND_ADDRESS || "0.0.0.0");