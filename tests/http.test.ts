import { describe, expect, it, vi } from "vitest";
import { ResilientHttpClient } from "../src/http.js";
import { RateLimiter } from "../src/rate-limiter.js";

describe("ResilientHttpClient", () => {
  it("retries retryable responses and honors Retry-After", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("busy", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn(async () => undefined);
    const limiter = new RateLimiter(10);
    const consume = vi.spyOn(limiter, "consume");
    const client = new ResilientHttpClient(
      1000,
      "CareerPortalMCP/test",
      limiter,
      fetchMock,
      sleep,
    );

    await expect(client.get(new URL("https://example.test/jobs"))).resolves
      .toMatchObject({ body: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("charges each 5xx retry against the provider rate limit", async () => {
    const limiter = new RateLimiter(10);
    const consume = vi.spyOn(limiter, "consume");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const client = new ResilientHttpClient(
      1000,
      "CareerPortalMCP/test",
      limiter,
      fetchMock,
      async () => undefined,
    );
    await expect(client.get(new URL("https://example.test/jobs"))).resolves
      .toMatchObject({ body: "ok" });
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("stops on anti-bot challenges", async () => {
    const client = new ResilientHttpClient(
      1000,
      "CareerPortalMCP/test",
      new RateLimiter(10),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("Please verify you are human", { status: 200 }),
      ),
    );
    await expect(
      client.get(new URL("https://example.test/jobs")),
    ).rejects.toMatchObject({ code: "ANTI_BOT_CHALLENGE" });
  });

  it("enforces the local provider rate limit", async () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);
    limiter.consume("provider");
    expect(() => limiter.consume("provider")).toThrowError(
      "Provider request rate limit reached",
    );
    now = 60_000;
    expect(() => limiter.consume("provider")).not.toThrow();
  });
});
