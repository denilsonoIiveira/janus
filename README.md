# Teste de autenticação por token do Janus

O Janus exige um token em cada requisição. O backend Elysia cria um token aleatório, registra-o pela API Admin e só então o entrega ao frontend. Este teste não autentica quem pede o token ao backend.

## Executar

1. Inicie o Janus e o backend: `docker compose up --build`.
2. No diretório `web`, instale as dependências com `bun install` e execute `bun run dev`.
3. Configure `VITE_JANUS_SERVER` no `web/.env.local` se o WebSocket do Janus tiver outro endereço. O endpoint de token é `/api/janus/token` por padrão; o Vite encaminha `/api` para o backend na porta 3000. Para outro endereço, use `VITE_TOKEN_API_URL`.
4. Clique em **Conectar e registrar**. O navegador pedirá um token ao backend antes de abrir a sessão Janus.

A API Admin do Janus e o backend escutam somente em `127.0.0.1` do host. Para servir o frontend sem o Vite, encaminhe `/api` ao backend por um proxy no mesmo domínio. A API Admin não deve ser publicada. Tokens registrados ficam na memória do Janus, não expiram automaticamente e são descartados quando ele reinicia.

## Verificações rápidas

- `curl -s -X POST http://127.0.0.1:8891/janus -H 'content-type: application/json' -d '{"janus":"create","transaction":"sem-token"}'` deve retornar erro 403 do Janus.
- `curl -s -X POST http://127.0.0.1:3000/api/janus/token` deve retornar um token; usá-lo no campo `token` da requisição anterior deve criar uma sessão.
- Em `backend`, execute `bun test`. Em `web`, execute `bun run build` e `bun run lint`.
