import { expect, test } from "bun:test";
import { createApp } from "./app";

const endpoint = "http://localhost/api/janus/token";

test("registra o token no Janus antes de entregá-lo", async () => {
  let sent: Record<string, unknown> | undefined;
  const adminFetch = (async (_url: string, options?: RequestInit) => {
    sent = JSON.parse(String(options?.body));
    return Response.json({ janus: "success" });
  }) as typeof fetch;

  const response = await createApp("http://127.0.0.1:7088/admin", adminFetch)
    .handle(new Request(endpoint, { method: "POST" }));
  const body = await response.json() as { token: string };

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body.token).toBe(sent?.token);
  expect(sent?.janus).toBe("add_token");
  expect(sent?.plugins).toEqual(["janus.plugin.sip"]);
  expect(typeof sent?.transaction).toBe("string");
});

test("não entrega token quando o Janus recusa o registro", async () => {
  const adminFetch = (async () =>
    Response.json({ janus: "error", error: { code: 403 } })) as typeof fetch;

  const response = await createApp("http://127.0.0.1:7088/admin", adminFetch)
    .handle(new Request(endpoint, { method: "POST" }));
  const body = await response.json() as Record<string, unknown>;

  expect(response.status).toBe(502);
  expect(body).toHaveProperty("error");
  expect(body).not.toHaveProperty("token");
});
