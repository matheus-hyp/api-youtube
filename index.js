// A ordem importa: env.js popula process.env (YOUTUBE_COOKIE, PORT) antes dos módulos que o leem.
import "./src/env.js";
import express from "express";
import { existsSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseVideoId } from "@distube/ytdl-core";
import { mp3, rawAudio, mp4, rawMp4, getInfo, getFormats, buscar, fetchYT } from "./src/youtube.js";

const app = express();
const port = process.env.PORT || 3000;
const PUBLICO = join(import.meta.dirname, "publico");
const MAX_AGE_MS = 10 * 60 * 1000;

app.disable("x-powered-by");
app.set("json spaces", 4);

const base = (req) => `${req.protocol}://${req.get("host")}`;

// Limpa downloads antigos em background, sem travar as requisições.
async function limparAntigos() {
    try {
        const files = await readdir(PUBLICO);
        for (const file of files) {
            if (file.startsWith(".")) continue;
            const caminho = join(PUBLICO, file);
            const { ctime } = await stat(caminho);
            if (Date.now() - ctime.getTime() > MAX_AGE_MS) {
                console.log("🗑️", file);
                await unlink(caminho).catch(() => {});
            }
        }
    } catch (e) {
        console.error("erro ao limpar publico:", e.message);
    }
}
limparAntigos();
setInterval(limparAntigos, 5 * 60 * 1000);

function validateUrl(req, res, next) {
    if (!req.query.url || !parseVideoId(req.query.url))
        return res.json({ success: false, error: "sem url ou URL inválida" });
    next();
}

// Remove do texto de erro qualquer menção à origem (domínios, nomes de serviço).
function limparErro(msg) {
    return String(msg || "erro ao processar requisição")
        .replace(/https?:\/\/[^\s"'`]+/gi, (m) =>
            /youtube|youtu\.be|ytimg|googlevideo/i.test(m) ? "[link removido]" : m
        )
        .replace(/you\s?tube|ytimg|googlevideo|innertube/gi, "o serviço")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// Envolve os handlers: erro vira JSON em vez de deixar a requisição pendurada.
const h = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        console.log("erro na rota:", e.message);
        if (!res.headersSent) res.json({ success: false, error: limparErro(e.message) });
    }
};

const data = (req) => ({ url: req.query.url, itag: req.query.itag, base: base(req) });

app.get("/", (req, res) =>
    res.json({
        success: true,
        name: "api",
        endpoints: {
            "/audio?url=&itag=": "mp3 a partir de uma URL ou ID do vídeo",
            "/video?url=&itag=": "mp4 com áudio a partir de uma URL ou ID do vídeo",
            "/raw-audio?url=&itag=": "áudio cru no formato original",
            "/raw-video?url=&itag=": "vídeo cru (sem áudio)",
            "/thumb?id=&size=": "capa do vídeo (mq, hq, max; padrão hq)",
            "/info?url=": "detalhes e itags disponíveis",
            "/formats?url=": "todos os formatos do vídeo",
            "/buscar?text=": "busca vídeos",
            "/url-download-allow": "lista de domínios liberados para download",
        },
    })
);

// Domínios liberados para download — lista fixa.
// `pattern` informa o padrão de URL que deve ser enviada.
const URL_DOWNLOAD_ALLOW = [
    { url: "youtube.com", pattern: "/watch*" },
    { url: "m.youtube.com", pattern: "/watch*" },
];

app.get("/url-download-allow", (req, res) =>
    res.json({ success: true, data: URL_DOWNLOAD_ALLOW })
);

app.get("/audio", validateUrl, h(async (req, res) => {
    const r = await mp3(data(req));
    if (!r?.file) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, ...r, file: `${base(req)}/arquivo/?arquivo=${r.file}` });
}));

app.get("/video", validateUrl, h(async (req, res) => {
    const r = await mp4(data(req));
    if (!r?.file) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, ...r, file: `${base(req)}/arquivo/?arquivo=${r.file}` });
}));

app.get("/raw-video", validateUrl, h(async (req, res) => {
    const r = await rawMp4(data(req));
    if (!r?.file) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, ...r, file: `${base(req)}/arquivo/?arquivo=${r.file}` });
}));

app.get("/raw-audio", validateUrl, h(async (req, res) => {
    const r = await rawAudio(data(req));
    if (!r?.file) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, ...r, file: `${base(req)}/arquivo/?arquivo=${r.file}` });
}));

app.get("/info", validateUrl, h(async (req, res) => {
    const data = await getInfo({ url: req.query.url, base: base(req) });
    if (!data) return res.json({ success: false, error: "erro ao buscar dados" });
    res.json({ success: true, ...data });
}));

app.get("/formats", validateUrl, h(async (req, res) => {
    const data = await getFormats({ url: req.query.url });
    if (!data) return res.json({ success: false, error: "erro ao buscar dados" });
    res.json({ success: true, data });
}));

app.get("/buscar", h(async (req, res) => {
    if (!req.query.text?.length)
        return res.json({ success: false, error: "termo ou frase de busca não fornecido" });
    const data = await buscar(req.query.text, base(req));
    res.json({ success: true, data });
}));

// Capa do vídeo servida pelo próprio domínio da API — o navegador nunca vê o CDN da origem.
const TAMANHOS = { mq: "mqdefault", hq: "hqdefault", sd: "sddefault", max: "maxresdefault", default: "default" };
const thumbCache = new Map(); // id -> { buf, type, exp }
const THUMB_TTL = 6 * 60 * 60 * 1000;

app.get("/thumb", h(async (req, res) => {
    const id = String(req.query.id || "");
    if (!/^[A-Za-z0-9_-]{11}$/.test(id))
        return res.json({ success: false, error: "id inválido" });

    const cache = thumbCache.get(id);
    if (cache && cache.exp > Date.now()) {
        res.set("Content-Type", cache.type).set("Cache-Control", "public, max-age=3600");
        return res.send(cache.buf);
    }

    const nome = TAMANHOS[String(req.query.size || "hq")] || TAMANHOS.hq;
    let r = await fetchYT(`https://i.ytimg.com/vi/${id}/${nome}.jpg`);
    // maxresdefault não existe em vídeos antigos: cai para a capa padrão.
    if (!r.ok) r = await fetchYT(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    if (!r.ok) return res.status(404).json({ success: false, error: "capa não encontrada" });

    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get("content-type") || "image/jpeg";

    if (thumbCache.size >= 300) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(id, { buf, type, exp: Date.now() + THUMB_TTL });

    res.set("Content-Type", type).set("Cache-Control", "public, max-age=3600");
    res.send(buf);
}));

app.get("/arquivo", (req, res) => {
    const { arquivo } = req.query;
    if (!arquivo) return res.json({ success: false, error: "sem arquivo" });
    // Bloqueia path traversal.
    if (arquivo.includes("..") || arquivo.includes("/") || arquivo.includes("\\"))
        return res.json({ success: false, error: "arquivo inválido" });

    const caminho = join(PUBLICO, arquivo);
    if (!existsSync(caminho)) return res.json({ success: false, error: "arquivo nao encontrado" });
    res.download(caminho);
});

app.listen(port, () => {
    console.log(`api-ytdl rodando em http://localhost:${port}`);
});
