# api-youtube

API 100% REST para busca e download de músicas e vídeos do YouTube. Feita em Node.js + Express, sem frontend — apenas endpoints JSON.

> **Baseado em [ytdl-simple-api](https://github.com/erickythierry/ytdl-simple-api)** de [erickythierry](https://github.com/erickythierry).
> Todo o crédito original pelo projeto vai para ele. Este é um fork simplificado e otimizado, removido de qualquer interface web e migrado para `@distube/ytdl-core` v5.

## Requisitos

- Node.js 20 ou superior
- `ffmpeg` resolvido automaticamente via `@ffmpeg-installer/ffmpeg`

## Instalação

```bash
npm install
npm start
```

A API sobe em `http://localhost:3000`. Use a variável `PORT` para mudar a porta:

```bash
PORT=8080 npm start
```

## Endpoints

Todos retornam JSON (exceto `/thumb`, que devolve a imagem). Os que baixam arquivos devolvem link de download **e os dados do vídeo** (nome, capa, duração etc.).

| Rota | Método | Parâmetros | Descrição |
|---|---|---|---|
| `/` | GET | — | Lista os endpoints disponíveis |
| `/audio` | GET | `url`, `itag` (opcional) | Converte para MP3 |
| `/video` | GET | `url`, `itag` (opcional) | Baixa MP4 com áudio (mux automático) |
| `/raw-audio` | GET | `url`, `itag` (opcional) | Áudio cru no formato original (m4a/webm) |
| `/raw-video` | GET | `url`, `itag` (opcional) | Vídeo cru, sem áudio |
| `/thumb` | GET | `id`, `size` (`mq`/`hq`/`max`) | Capa do vídeo, servida pelo domínio da API |
| `/info` | GET | `url` | Detalhes do vídeo e itags disponíveis |
| `/formats` | GET | `url` | Formatos disponíveis do vídeo |
| `/buscar` | GET | `text` | Busca vídeos |
| `/arquivo` | GET | `arquivo` | Faz o download de um arquivo gerado |

> O parâmetro `url` aceita **URL completa ou apenas o ID do vídeo** (`dQw4w9WgXcQ`). Os resultados de `/buscar` já trazem o `url` nesse formato de ID, pronto para usar.

### Exemplos

```bash
# Buscar
curl "http://localhost:3000/buscar?text=never+gonna+give+you+up"

# Informações do vídeo (URL ou ID)
curl "http://localhost:3000/info?url=dQw4w9WgXcQ"
curl "http://localhost:3000/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Baixar como MP3
curl "http://localhost:3000/audio?url=dQw4w9WgXcQ"

# Baixar MP4 com áudio
curl "http://localhost:3000/video?url=dQw4w9WgXcQ"

# Capa do vídeo
curl "http://localhost:3000/thumb/?id=dQw4w9WgXcQ"
```

### Respostas

Sucesso na geração de um arquivo (com os dados do vídeo):

```json
{
    "success": true,
    "file": "http://localhost:3000/arquivo/?arquivo=audio_dQw4w9WgXcQ.mp3",
    "title": "Rick Astley - Never Gonna Give You Up (Official Video)",
    "guid": "dQw4w9WgXcQ",
    "thumb": "http://localhost:3000/thumb/?id=dQw4w9WgXcQ",
    "duration": 214,
    "loops": 1832044809,
    "provedor": "Rick Astley"
}
```

Parâmetro `url` ausente ou inválido:

```json
{
    "success": false,
    "error": "sem url ou URL inválida"
}
```

### Sem exposição da origem

As respostas **não revelam de onde os dados vêm** — nenhuma URL ou nome de serviço da fonte aparece em JSON algum:

- **`thumb`** sempre aponta para o `/thumb` desta própria API; o navegador só acessa o seu domínio (com cache de 6h no servidor e 1h no navegador).
- **`/formats`** devolve apenas metadados (`itag`, `container`, `qualityLabel`...) — o campo `url` do stream (que aponta para o CDN da origem) é omitido.
- **`/info`** traz um `videoDetails` higienizado: título, descrição, duração, views, likes, data, categoria e canal (apenas o nome) — sem URLs.
- **`/buscar`** devolve `url` como ID puro e capa via `/thumb`.
- **Erros** passam por um filtro que substitui qualquer menção à origem por `o serviço`.

> Não é necessário criar chave de API nem projeto no Google: todos os dados (nome, capa, duração, views) vêm do fluxo de busca que a própria API já executa — de graça e sem limite de cota.

### Parâmetro `itag`

Opcional. Escolhe um formato específico (ex.: `itag=140` para m4a). Sem ele, a API escolhe a melhor opção disponível. Veja as opções em `/info?url=...`.

## 🍪 YOUTUBE_COOKIE (alternativa 1 — fazer o YouTube confiar na sessão)

O YouTube bloqueia requisições vindas de IPs de datacenter (Vercel, Railway, AWS, CapRover...) com o erro:

```json
{"success": false, "error": "Could not play ...: Sign in to confirm you're not a bot"}
```

Se você não quiser usar proxy, defina a variável de ambiente **`YOUTUBE_COOKIE`** com os cookies de uma sessão **logada** no YouTube. Localmente (IP residencial) funciona sem nada, mas em servidor quase sempre é necessária uma das duas soluções.

#### Como gerar

1. Abra o YouTube no seu navegador e **faça login** em uma conta.
2. Instale uma extensão que exporte cookies no formato Netscape/JSON, como [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg) ou [Cookie-Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm).
3. Exporte os cookies (ou copie o cabeçalho `Cookie` completo da aba Network → qualquer requisição → Headers → Request Headers).
4. **Não faça logout** da conta depois de exportar — isso invalida os cookies.

#### Como configurar

**CapRover:** App → Configuration / Environment Variables → adicione `YOUTUBE_COOKIE` com o valor colado.

**Docker:**

```bash
docker run -p 3000:80 -e YOUTUBE_COOKIE="SID=...; HSID=...; __Secure-3PSID=..." api-ytdl
```

**Local:** crie um arquivo `.env` (já está no `.gitignore`):

```
YOUTUBE_COOKIE=SID=...; HSID=...; __Secure-3PSID=...
```

> ⚠️ **Segurança:** o cookie equivale ao login da sua conta. Nunca faça commit dele, nunca compartilhe e use uma conta descartável se possível. Ao iniciar a API com o cookie ativo, o log mostra `🍪 YOUTUBE_COOKIE ativo`.
>
> Se o cookie expirar (geralmente semanas), basta exportar novamente.

## 🔀 YOUTUBE_PROXY (alternativa 2 — fazer o YouTube ver outro IP)

Se você **não quiser usar cookie**, defina **`YOUTUBE_PROXY`** com um proxy HTTP(S). Todas as requisições ao YouTube (player, formatos e o download em si) passam por um **túnel TCP CONNECT**, então o YouTube enxerga o IP do proxy — e não o IP de datacenter do servidor.

```bash
# formato: protocolo://host:porta (com usuário/senha se o proxy exigir)
YOUTUBE_PROXY=http://127.0.0.1:8899
YOUTUBE_PROXY=http://usuario:senha@proxy.exemplo.com:8080
```

Ao iniciar, o log confirma:

```
🔀 YOUTUBE_PROXY ativo — YouTube acessado via proxy.exemplo.com:8080
```

Também são reconhecidos os nomes padrão `HTTPS_PROXY` e `HTTP_PROXY` (neste ordem de prioridade: `YOUTUBE_PROXY` > `HTTPS_PROXY` > `HTTP_PROXY`).

### O que usar como proxy

| Tipo de proxy | Serve? | Observação |
|---|---|---|
| Proxy **residencial** (ou 4G/móvel) | ✅ ideal | IP de verdade, YouTube não bloqueia |
| Proxy **datacenter** barato | ⚠️ pode bloquear | Muitos IPs de datacenter também estão na lista negra |
| Proxy do seu próprio roteador/VPS | ⚠️ depende | VPS com IP novo costuma funcionar no início |
| SOCKS5 (`socks5://...`) | ❌ não | Apenas HTTP(S) com CONNECT |

Exemplos práticos:

- **Seu próprio IP em casa:** configure um proxy HTTP local (ex.: com `ssh -D` ou um container pequeno) e aponte `YOUTUBE_PROXY` para ele — mas cuidado com a carga.
- **Provedores comerciais:** a maioria vende acesso no formato `http://user:pass@host:porta`.

> As duas opções podem ser usadas **ao mesmo tempo** (`YOUTUBE_COOKIE` + `YOUTUBE_PROXY`): o cookie gera confiança na sessão e o proxy esconde o IP. Nesse caso o log mostra `🍪 YOUTUBE_COOKIE ativo + 🔀 proxy ...`.

## Otimizações deste fork

- **100% API** — removidos o frontend HTML/JS, o listador de diretórios e as rotas estáticas.
- **Um único `getInfo` por requisição** — antes, o download de MP4 fazia duas buscas ao YouTube (uma para o vídeo e outra para o áudio).
- **MP4 sem re-encode** — o áudio m4a é unido ao vídeo com `-c copy`, evitando transcodificação e mantendo a qualidade original.
- **Downloads em paralelo** — vídeo e áudio são baixados simultaneamente.
- **`ffmpeg` via `spawn`** — removida a dependência não mantida `fluent-ffmpeg`.
- **Limpeza em background** — a pasta `publico/` é limpa por timer, sem travar requisições.
- **Menos dependências** — de 8 pacotes para 5: `express`, `@distube/ytdl-core`, `@ffmpeg-installer/ffmpeg`, `yt-search` e `undici` (proxy).
- **Erros em JSON** — handlers embrulhados para nunca deixar a requisição pendurada.
- **Proteção contra path traversal** no endpoint `/arquivo`.
- **Respostas sem exposição da origem** — capa servida pelo próprio `/thumb`, formatos sem `url` do CDN, erros filtrados.

## Estrutura

```
index.js        # Servidor Express, rotas, /thumb e limpeza
src/youtube.js  # Toda a lógica: download, conversão, busca, proxy
src/env.js      # Carrega o .env nativamente (sem dependência)
publico/        # Arquivos gerados (limpos automaticamente)
```

## Docker

```bash
docker build -t api-ytdl .
docker run -p 3000:80 api-ytdl
```

## Licença

MIT — veja [LICENSE](LICENSE).

Créditos originais: [erickythierry/ytdl-simple-api](https://github.com/erickythierry/ytdl-simple-api).
