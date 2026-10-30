import { Ytdl } from "@distube/ytdl-core";
import yts from "yt-search";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

// Uma única sessão compartilhada: visitor data e resolução de player reutilizados em todas as requisições.
export const ytdl = new Ytdl();

const PUBLICO = join(import.meta.dirname, "..", "publico");

// `itag` chega da query string como texto; a v5 espera número.
function toQuality(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
}

const usable = (f) => f.hasAudio && !f.hasVideo && !f.isDrm && !f.isOtf;

// Melhor faixa de áudio: prefere m4a (merge sem re-encode), depois maior bitrate.
function pickAudio(formats, itag) {
    const audio = formats.filter(usable);
    const asked = toQuality(itag);
    if (asked !== undefined) {
        const found = audio.find((f) => f.itag === asked);
        if (found) return found;
    }
    const m4a = audio.filter((f) => f.container === "mp4");
    const pool = m4a.length ? m4a : audio;
    return [...pool].sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
}

// Vídeo: itag pedido, ou a melhor opção mp4 (360p–720p) com áudio preferido.
function pickVideo(formats, itag) {
    const asked = toQuality(itag);
    if (asked !== undefined) {
        const found = formats.find((f) => f.itag === asked && !f.isDrm && !f.isOtf);
        if (found) return found;
    }
    const lista = getItag(formats);
    if (lista.length) return formats.find((f) => f.itag === lista[0].itag);
    return formats.find((f) => f.hasVideo && !f.isDrm && !f.isOtf);
}

function downloadTo(info, opts, dest) {
    return new Promise((resolve, reject) => {
        const stream = ytdl.download(info, opts);
        const out = createWriteStream(dest);
        stream.on("error", reject);
        out.on("error", reject);
        out.on("finish", resolve);
        stream.pipe(out);
    });
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const p = spawn(ffmpegPath, ["-y", ...args]);
        let err = "";
        p.stderr.on("data", (d) => (err += d));
        p.on("error", reject);
        p.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(err.slice(-400) || "ffmpeg falhou"))
        );
    });
}

// Áudio convertido para mp3: um getInfo, um download, uma conversão.
export async function mp3(data) {
    if (!data?.url) return;
    try {
        const info = await ytdl.getInfo(data.url);
        const id = info.videoDetails.id;
        const audio = pickAudio(info.formats, data.itag);
        if (!audio) return;

        const tmp = join(PUBLICO, `tmp_${id}_${audio.itag}.${audio.container}`);
        const out = `audio_${id}.mp3`;
        await downloadTo(info, { format: audio }, tmp);
        await runFfmpeg(["-i", tmp, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", join(PUBLICO, out)]);
        await unlink(tmp).catch(() => {});
        return out;
    } catch (e) {
        console.log("erro mp3:", e.message);
    }
}

// Áudio cru no formato original, sem conversão.
export async function rawAudio(data) {
    if (!data?.url) return;
    try {
        const info = await ytdl.getInfo(data.url);
        const id = info.videoDetails.id;
        const audio = pickAudio(info.formats, data.itag);
        if (!audio) return;

        const out = `audio_${id}.${audio.container}`;
        await downloadTo(info, { format: audio }, join(PUBLICO, out));
        return out;
    } catch (e) {
        console.log("erro rawAudio:", e.message);
    }
}

// Vídeo: se o formato já tem áudio, só baixa. Senão, baixa vídeo + m4a em paralelo e une com -c copy.
export async function mp4(data) {
    if (!data?.url) return;
    try {
        const info = await ytdl.getInfo(data.url);
        const id = info.videoDetails.id;
        const video = pickVideo(info.formats, data.itag);
        if (!video) return;

        const out = `video_${id}.mp4`;
        const dest = join(PUBLICO, out);

        if (video.hasAudio) {
            await downloadTo(info, { format: video }, dest);
            return out;
        }

        const audio = pickAudio(info.formats);
        const vTmp = join(PUBLICO, `tmp_${id}_v${video.itag}.mp4`);
        const aTmp = join(PUBLICO, `tmp_${id}_a${audio.itag}.${audio.container}`);

        await Promise.all([
            downloadTo(info, { format: video }, vTmp),
            downloadTo(info, { format: audio }, aTmp),
        ]);

        const args = ["-i", vTmp, "-i", aTmp, "-map", "0:v:0", "-map", "1:a:0"];
        // m4a entra no mp4 sem re-encode; webm/opus precisa de transcodificação.
        args.push(...(audio.container === "mp4" ? ["-c", "copy"] : ["-c:v", "copy", "-c:a", "aac"]));
        args.push(dest);

        await runFfmpeg(args);
        await Promise.all([unlink(vTmp).catch(() => {}), unlink(aTmp).catch(() => {})]);
        return out;
    } catch (e) {
        console.log("erro mp4:", e.message);
    }
}

// Vídeo cru (sem áudio), como o YouTube o serve.
export async function rawMp4(data) {
    if (!data?.url) return;
    try {
        const info = await ytdl.getInfo(data.url);
        const id = info.videoDetails.id;
        const video = pickVideo(info.formats, data.itag);
        if (!video) return;

        const out = `video_${id}.${video.container}`;
        await downloadTo(info, { format: video }, join(PUBLICO, out));
        return out;
    } catch (e) {
        console.log("erro rawMp4:", e.message);
    }
}

export async function getInfo(data) {
    if (!data?.url) return;
    const info = await ytdl.getInfo(data.url);
    const details = info.videoDetails;
    return {
        video: getItag(info.formats),
        audio: getItag(info.formats, "audio"),
        title: details.title,
        videoid: details.id,
        thumb: details.thumbnails.at(-1)?.url,
        duration: details.lengthSeconds,
        views: details.viewCount,
        videoDetails: details,
    };
}

export async function getFormats(data) {
    if (!data?.url) return;
    const info = await ytdl.getInfo(data.url);
    return info.formats;
}

export async function buscar(search) {
    if (!search) return "sem busca";
    const { videos } = await yts(search);
    return videos.slice(0, 5).map((v) => ({
        title: v.title,
        id: v.videoId,
        url: v.url,
        thumb: v.thumbnail,
        views: v.views,
        duration: { seconds: v.duration.seconds, time: v.duration.timestamp },
    }));
}

export function getItag(lista, type = "video") {
    if (type == "video") {
        let lista2 = lista
            .filter((i) => {
                if (i.container == "mp4") {
                    if (
                        i.qualityLabel == "360p" ||
                        i.qualityLabel == "480p" ||
                        i.qualityLabel == "720p"
                    )
                        return true;
                }
            })
            .map((i) => {
                return {
                    q: i.qualityLabel,
                    itag: i.itag,
                    audio: i.hasAudio,
                    size: i.contentLength,
                };
            });
        lista2 = filterDuplicates(lista2, "q");

        // Vídeos antigos ou muito curtos podem não ter 360p/480p/720p:
        // usa qualquer resolução mp4 disponível.
        if (!lista2.length) {
            lista2 = filterDuplicates(
                lista
                    .filter((i) => i.container == "mp4" && i.qualityLabel)
                    .map((i) => ({
                        q: i.qualityLabel,
                        itag: i.itag,
                        audio: i.hasAudio,
                        size: i.contentLength,
                    })),
                "q"
            );
        }

        return lista2.sort((a, b) => {
            let qualityA = parseInt(a.q);
            let qualityB = parseInt(b.q);
            if (qualityA !== qualityB) return qualityB - qualityA;
            if (a.audio !== b.audio) return a.audio ? -1 : 1;
            return 0;
        });
    }

    let result = lista
        .filter((i) => {
            if (i.mimeType?.includes("audio")) {
                if (i.audioBitrate >= 128) return true;
            }
        })
        .map((i) => {
            return {
                bitrate: i.audioBitrate,
                itag: i.itag,
                size: i.contentLength,
            };
        })
        .sort((a, b) => {
            if (a.bitrate > b.bitrate) return -1;
            return 1;
        });
    return result;
}

function filterDuplicates(array, param) {
    return array.filter(
        (item, index, self) =>
            self.findIndex((other) => other[param] === item[param]) === index
    );
}
