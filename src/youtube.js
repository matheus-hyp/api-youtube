// Garante que .env/YOUTUBE_COOKIE/YOUTUBE_PROXY estejam carregados mesmo com import direto.
import "./env.js";
import { Ytdl } from "@distube/ytdl-core";
import { ProxyAgent } from "undici";
import yts from "yt-search";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";

// Uma única sessão compartilhada: visitor data e resolução de player reutilizados em todas as requisições.
//
// Em servidores em nuvem o IP é de datacenter e o YouTube exige login ("Sign in to confirm
// you're not a bot"). Duas formas de contornar, usáveis isoladas ou juntas:
//
//   YOUTUBE_COOKIE — cookies de uma sessão logada no YouTube (faz o YouTube confiar na sessão);
//   YOUTUBE_PROXY  — proxy HTTP(S) com túnel TCP CONNECT (faz o YouTube ver outro IP).
//
// Nunca faça commit desses valores.
const cookie = process.env.YOUTUBE_COOKIE?.trim();
const proxyUrl = (
    process.env.YOUTUBE_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ""
).trim();

const options = {};
if (cookie) options.cookie = cookie;

let proxyAgent = null;
let proxyHost = null;
if (proxyUrl) {
    try {
        proxyHost = new URL(proxyUrl).host;
        proxyAgent = new ProxyAgent(proxyUrl);
        // O fetch do Node (undici) aceita `dispatcher`; assim TODAS as requisições do
        // ytdl — player, formatos e download — saem pelo túnel CONNECT do proxy.
        options.fetch = (input, init) => fetch(input, { ...init, dispatcher: proxyAgent });
    } catch (e) {
        throw new Error(`YOUTUBE_PROXY inválido ("${proxyUrl}"): ${e.message}`);
    }
}

export const ytdl = new Ytdl(options);

// fetch que respeita o proxy configurado — usado para buscar a capa via /thumb.
export function fetchYT(input, init) {
    return proxyAgent ? fetch(input, { ...init, dispatcher: proxyAgent }) : fetch(input, init);
}

if (cookie && proxyHost) {
    console.log(`🍪 YOUTUBE_COOKIE ativo + 🔀 proxy ${proxyHost}`);
} else if (cookie) {
    console.log("🍪 YOUTUBE_COOKIE ativo — usando sessão autenticada");
} else if (proxyHost) {
    console.log(`🔀 YOUTUBE_PROXY ativo — YouTube acessado via ${proxyHost}`);
} else {
    console.log(
        "⚠️ sem YOUTUBE_COOKIE e sem YOUTUBE_PROXY — em servidores em nuvem o YouTube pode bloquear com 'not a bot'"
    );
}

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

// Links que revelariam a origem (domínios da fonte) — removidos de qualquer texto de retorno.
const LINK_ORIGEM = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be|ytimg\.com|ggpht\.com|googlevideo\.com)[^\s"']*/gi;
function limparTexto(s) {
    return typeof s === "string" ? s.replace(LINK_ORIGEM, "").trim() : s;
}

// Dados do vídeo para o cliente — nome, capa, duração etc. — sem expor a origem:
// a capa aponta para o /thumb desta própria API (nunca para o CDN da fonte).
function meta(info, base) {
    const d = info.videoDetails;
    return {
        title: d.title,
        id: d.id,
        thumb: `${base ?? ""}/thumb/?id=${d.id}`,
        duration: d.lengthSeconds,
        views: d.viewCount,
        channel: d.author?.name,
    };
}

// Áudio convertido para mp3: um getInfo, um download, uma conversão.
export async function mp3(data) {
    if (!data?.url) return;
    const info = await ytdl.getInfo(data.url);
    const id = info.videoDetails.id;
    const audio = pickAudio(info.formats, data.itag);
    if (!audio) throw new Error("nenhum formato de áudio disponível");

    const tmp = join(PUBLICO, `tmp_${id}_${audio.itag}.${audio.container}`);
    const out = `audio_${id}.mp3`;
    try {
        await downloadTo(info, { format: audio }, tmp);
        await runFfmpeg(["-i", tmp, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", join(PUBLICO, out)]);
    } finally {
        await unlink(tmp).catch(() => {});
    }
    return { file: out, ...meta(info, data.base) };
}

// Áudio cru no formato original, sem conversão.
export async function rawAudio(data) {
    if (!data?.url) return;
    const info = await ytdl.getInfo(data.url);
    const id = info.videoDetails.id;
    const audio = pickAudio(info.formats, data.itag);
    if (!audio) throw new Error("nenhum formato de áudio disponível");

    const out = `audio_${id}.${audio.container}`;
    await downloadTo(info, { format: audio }, join(PUBLICO, out));
    return { file: out, ...meta(info, data.base) };
}

// Vídeo: se o formato já tem áudio, só baixa. Senão, baixa vídeo + m4a em paralelo e une com -c copy.
export async function mp4(data) {
    if (!data?.url) return;
    const info = await ytdl.getInfo(data.url);
    const id = info.videoDetails.id;
    const video = pickVideo(info.formats, data.itag);
    if (!video) throw new Error("nenhum formato de vídeo disponível");

    const out = `video_${id}.mp4`;
    const dest = join(PUBLICO, out);

    if (video.hasAudio) {
        await downloadTo(info, { format: video }, dest);
        return { file: out, ...meta(info, data.base) };
    }

    const audio = pickAudio(info.formats);
    const vTmp = join(PUBLICO, `tmp_${id}_v${video.itag}.mp4`);
    const aTmp = join(PUBLICO, `tmp_${id}_a${audio.itag}.${audio.container}`);

    try {
        await Promise.all([
            downloadTo(info, { format: video }, vTmp),
            downloadTo(info, { format: audio }, aTmp),
        ]);

        const args = ["-i", vTmp, "-i", aTmp, "-map", "0:v:0", "-map", "1:a:0"];
        // m4a entra no mp4 sem re-encode; webm/opus precisa de transcodificação.
        args.push(...(audio.container === "mp4" ? ["-c", "copy"] : ["-c:v", "copy", "-c:a", "aac"]));
        args.push(dest);

        await runFfmpeg(args);
    } finally {
        await Promise.all([unlink(vTmp).catch(() => {}), unlink(aTmp).catch(() => {})]);
    }
    return { file: out, ...meta(info, data.base) };
}

// Vídeo cru (sem áudio), como a fonte o serve.
export async function rawMp4(data) {
    if (!data?.url) return;
    const info = await ytdl.getInfo(data.url);
    const id = info.videoDetails.id;
    const video = pickVideo(info.formats, data.itag);
    if (!video) throw new Error("nenhum formato de vídeo disponível");

    const out = `video_${id}.${video.container}`;
    await downloadTo(info, { format: video }, join(PUBLICO, out));
    return { file: out, ...meta(info, data.base) };
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
        thumb: `${data.base ?? ""}/thumb/?id=${details.id}`,
        duration: details.lengthSeconds,
        views: details.viewCount,
        channel: details.author?.name,
        // Subconjunto sanitizado: sem URLs, sem canais, sem referências à origem.
        videoDetails: {
            id: details.id,
            title: limparTexto(details.title),
            description: limparTexto(details.description),
            lengthSeconds: details.lengthSeconds,
            viewCount: details.viewCount,
            likes: details.likes,
            publishDate: details.publishDate,
            uploadDate: details.uploadDate,
            category: details.category,
            isLive: details.isLive,
            author: { name: details.author?.name },
        },
    };
}

export async function getFormats(data) {
    if (!data?.url) return;
    const info = await ytdl.getInfo(data.url);
    // Sem `url`/`client`: o campo url aponta para o CDN da origem e seria uma exposição.
    return info.formats.map((f) => ({
        itag: f.itag,
        container: f.container,
        mimeType: f.mimeType,
        codecs: f.codecs,
        qualityLabel: f.qualityLabel,
        audioQuality: f.audioQuality,
        audioBitrate: f.audioBitrate,
        hasAudio: f.hasAudio,
        hasVideo: f.hasVideo,
        width: f.width,
        height: f.height,
        fps: f.fps,
        contentLength: f.contentLength,
    }));
}

export async function buscar(search, base) {
    if (!search) return "sem busca";
    const { videos } = await yts(search);
    return videos.slice(0, 5).map((v) => ({
        title: limparTexto(v.title),
        id: v.videoId,
        // Passe este valor em ?url= — a API aceita o ID puro.
        url: v.videoId,
        thumb: `${base ?? ""}/thumb/?id=${v.videoId}`,
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
