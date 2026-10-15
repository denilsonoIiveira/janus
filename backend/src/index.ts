import { createApp } from "./app";

const port = Number(Bun.env.PORT ?? "3000");
const adminUrl = Bun.env.JANUS_ADMIN_URL ?? "http://127.0.0.1:7088/admin";

createApp(adminUrl).listen({ hostname: "127.0.0.1", port });

console.log(`API de tokens Janus em http://127.0.0.1:${port}`);
