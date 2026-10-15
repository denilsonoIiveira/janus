import { Elysia } from "elysia";

type JanusResponse = { janus?: string };

export function createApp(
  adminUrl: string,
  fetchAdmin: typeof fetch = fetch,
) {
  return new Elysia().post("/api/janus/token", async ({ set, status }) => {
    set.headers["cache-control"] = "no-store";

    const token = crypto.randomUUID();

    try {
      const response = await fetchAdmin(adminUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          janus: "add_token",
          transaction: crypto.randomUUID(),
          token,
          plugins: ["janus.plugin.sip"],
        }),
        signal: AbortSignal.timeout(5000),
      });
      const result = (await response.json()) as JanusResponse;

      if (response.ok && result.janus === "success") {
        return { token };
      }
    } catch (error) {
      console.error("Falha ao acessar a API Admin do Janus", error);
    }

    return status(502, { error: "Não foi possível registrar o token no Janus" });
  });
}
