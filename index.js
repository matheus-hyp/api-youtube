import express from "express";
import { existsSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseVideoId } from "@distube/ytdl-core";
import { mp3, rawAudio, mp4, rawMp4, getInfo, getFormats, buscar } from "./src/youtube.js";

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

// Envolve os handlers: erro vira JSON em vez de deixar a requisição pendurada.
const h = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        console.log("erro na rota:", e.message);
        if (!res.headersSent) res.json({ success: false, error: "erro ao processar requisição" });
    }
};

const data = (req) => ({ url: req.query.url, itag: req.query.itag });

app.get("/", (req, res) =>
    res.json({
        success: true,
        name: "api-ytdl",
        endpoints: {
            "/audio?url=&itag=": "mp3 a partir de uma URL do YouTube",
            "/video?url=&itag=": "mp4 com áudio a partir de uma URL do YouTube",
            "/raw-audio?url=&itag=": "áudio cru no formato original",
            "/raw-video?url=&itag=": "vídeo cru (sem áudio)",
            "/info?url=": "detalhes e itags disponíveis",
            "/formats?url=": "todos os formatos do vídeo",
            "/buscar?text=": "busca vídeos no YouTube",
        },
    })
);

app.get("/audio", validateUrl, h(async (req, res) => {
    const arquivo = await mp3(data(req));
    if (!arquivo) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, file: `${base(req)}/arquivo/?arquivo=${arquivo}` });
}));

app.get("/video", validateUrl, h(async (req, res) => {
    const arquivo = await mp4(data(req));
    if (!arquivo) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, file: `${base(req)}/arquivo/?arquivo=${arquivo}` });
}));

app.get("/raw-video", validateUrl, h(async (req, res) => {
    const arquivo = await rawMp4(data(req));
    if (!arquivo) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, file: `${base(req)}/arquivo/?arquivo=${arquivo}` });
}));

app.get("/raw-audio", validateUrl, h(async (req, res) => {
    const arquivo = await rawAudio(data(req));
    if (!arquivo) return res.json({ success: false, error: "erro ao baixar arquivo" });
    res.json({ success: true, file: `${base(req)}/arquivo/?arquivo=${arquivo}` });
}));

app.get("/info", validateUrl, h(async (req, res) => {
    const data = await getInfo({ url: req.query.url });
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
    const data = await buscar(req.query.text);
    res.json({ success: true, data });
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
