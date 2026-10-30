import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Carrega variáveis de um arquivo .env, se existir — sem dependência externa.
// Valores já presentes no process.env (ex.: definidos pelo CapRover/Docker) têm prioridade.
const envFile = join(import.meta.dirname, "..", ".env");

if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
        if (!line || line.trimStart().startsWith("#")) continue;
        const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const [, key, raw] = match;
        if (key in process.env) continue;
        // Remove aspas simples ou duplas envolvendo o valor.
        process.env[key] = raw.replace(/^(["'])(.*)\1$/, "$2");
    }
}
