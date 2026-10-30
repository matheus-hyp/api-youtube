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

Todos os endpoints retornam JSON. Os que baixam arquivos devolvem um link de download.

| Rota | Método | Parâmetros | Descrição |
|---|---|---|---|
| `/` | GET | — | Lista os endpoints disponíveis |
| `/audio` | GET | `url`, `itag` (opcional) | Converte para MP3 |
| `/video` | GET | `url`, `itag` (opcional) | Baixa MP4 com áudio (mux automático) |
| `/raw-audio` | GET | `url`, `itag` (opcional) | Áudio cru no formato original (m4a/webm) |
| `/raw-video` | GET | `url`, `itag` (opcional) | Vídeo cru, sem áudio |
| `/info` | GET | `url` | Detalhes do vídeo e itags disponíveis |
| `/formats` | GET | `url` | Todos os formatos que o YouTube oferece |
| `/buscar` | GET | `text` | Busca vídeos no YouTube |
| `/arquivo` | GET | `arquivo` | Faz o download de um arquivo gerado |

### Exemplos

```bash
# Buscar
curl "http://localhost:3000/buscar?text=never+gonna+give+you+up"

# Informações do vídeo
curl "http://localhost:3000/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Baixar como MP3
curl "http://localhost:3000/audio?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Baixar MP4 com áudio
curl "http://localhost:3000/video?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

### Respostas

Sucesso na geração de um arquivo:

```json
{
    "success": true,
    "file": "http://localhost:3000/arquivo/?arquivo=audio_dQw4w9WgXcQ.mp3"
}
```

Parâmetro `url` ausente ou inválido:

```json
{
    "success": false,
    "error": "sem url ou URL inválida"
}
```

### Parâmetro `itag`

Opcional. Escolhe um formato específico (ex.: `itag=140` para m4a). Sem ele, a API escolhe a melhor opção disponível. Veja as opções em `/info?url=...`.

## Otimizações deste fork

- **100% API** — removidos o frontend HTML/JS, o listador de diretórios e as rotas estáticas.
- **Um único `getInfo` por requisição** — antes, o download de MP4 fazia duas buscas ao YouTube (uma para o vídeo e outra para o áudio).
- **MP4 sem re-encode** — o áudio m4a é unido ao vídeo com `-c copy`, evitando transcodificação e mantendo a qualidade original.
- **Downloads em paralelo** — vídeo e áudio são baixados simultaneamente.
- **`ffmpeg` via `spawn`** — removida a dependência não mantida `fluent-ffmpeg`.
- **Limpeza em background** — a pasta `publico/` é limpa por timer, sem travar requisições.
- **Menos dependências** — de 8 pacotes para 4: `express`, `@distube/ytdl-core`, `@ffmpeg-installer/ffmpeg` e `yt-search`.
- **Erros em JSON** — handlers embrulhados para nunca deixar a requisição pendurada.
- **Proteção contra path traversal** no endpoint `/arquivo`.

## Estrutura

```
index.js        # Servidor Express e rotas
src/youtube.js  # Toda a lógica: download, conversão, busca
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
