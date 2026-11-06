import { describe, expect, it, vi } from "vitest";
import type { AuditEvent, AuditSink } from "../src/audit.js";
import { MutationManager } from "../src/mutations.js";
import type { ProviderAdapter } from "../src/providers/provider.js";
import type { MutationRequest, ProviderName } from "../src/types.js";

class MemoryAudit implements AuditSink {
  events: AuditEvent[] = [];
  write(event: AuditEvent): void {
    this.events.push(event);
  }
}

function fakeProvider(
  execute = vi.fn(async () => ({ updated: true })),
  readState = vi.fn(async () => ({ headline: "Old headline" })),
): ProviderAdapter {
  return {
    name: "linkedin",
    capabilities: () => [{
      provider: "linkedin",
      operation: "update_profile",
      support: "official_api",
      access: "oauth",
      scopes: ["profile.write"],
      mutation: true,
      enabled: true,
    }],
    searchJobs: vi.fn(),
    getJobDetails: vi.fn(),
    readAccount: vi.fn(),
    readMutationState: readState,
    executeMutation: execute,
  };
}

const request: MutationRequest = {
  provider: "linkedin",
  kind: "profile",
  changes: [{ field: "headline", operation: "set", value: "Engineer" }],
};

describe("MutationManager", () => {
  it("is disabled by default", async () => {
    const manager = new MutationManager(
      false,
      60_000,
      new Map(),
      new MemoryAudit(),
    );
    await expect(manager.preview(request)).rejects.toThrowError(
      "Mutations are disabled",
    );
  });

  it("requires an exact, unexpired, single-use confirmation", async () => {
    let now = 1000;
    const execute = vi.fn(async () => ({ updated: true }));
    const providers = new Map<ProviderName, ProviderAdapter>([
      ["linkedin", fakeProvider(execute)],
    ]);
    const manager = new MutationManager(
      true,
      60_000,
      providers,
      new MemoryAudit(),
      () => now,
    );
    const preview = await manager.preview(request);

    await expect(
      manager.execute(preview.operationId, preview.previewHash, "yes"),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(execute).not.toHaveBeenCalled();

    const second = await manager.preview(request);
    await expect(
      manager.execute(
        second.operationId,
        second.previewHash,
        second.confirmationPhrase,
      ),
    ).resolves.toEqual({ updated: true });
    await expect(
      manager.execute(
        second.operationId,
        second.previewHash,
        second.confirmationPhrase,
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

    const expired = await manager.preview(request);
    now = 61_001;
    await expect(
      manager.execute(
        expired.operationId,
        expired.previewHash,
        expired.confirmationPhrase,
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  });

  it("rejects password fields before preview", async () => {
    const manager = new MutationManager(
      true,
      60_000,
      new Map([["linkedin", fakeProvider()]]),
      new MemoryAudit(),
    );
    await expect(
      manager.preview({
        ...request,
        changes: [{
          field: "password",
          operation: "set",
          value: "never",
        }],
      }),
    ).rejects.toThrowError("Password fields are never accepted");
  });

  it("rejects state drift after confirmation", async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ headline: "Old headline" })
      .mockResolvedValueOnce({ headline: "Changed elsewhere" });
    const execute = vi.fn(async () => ({ updated: true }));
    const manager = new MutationManager(
      true,
      60_000,
      new Map([["linkedin", fakeProvider(execute, readState)]]),
      new MemoryAudit(),
    );
    const preview = await manager.preview(request);
    await expect(
      manager.execute(
        preview.operationId,
        preview.previewHash,
        preview.confirmationPhrase,
      ),
    ).rejects.toMatchObject({ code: "STATE_DRIFT" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("treats already-current values as an idempotent no-op", async () => {
    const execute = vi.fn(async () => ({ updated: true }));
    const manager = new MutationManager(
      true,
      60_000,
      new Map([[
        "linkedin",
        fakeProvider(
          execute,
          vi.fn(async () => ({ headline: "Engineer" })),
        ),
      ]]),
      new MemoryAudit(),
    );
    await expect(manager.preview(request)).rejects.toThrowError(
      "already match current provider state",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("serializes concurrent writes for the same provider", async () => {
    let active = 0;
    let maxActive = 0;
    const execute = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { updated: true };
    });
    const manager = new MutationManager(
      true,
      60_000,
      new Map([["linkedin", fakeProvider(execute)]]),
      new MemoryAudit(),
    );
    const first = await manager.preview(request);
    const second = await manager.preview({
      ...request,
      changes: [{ field: "summary", operation: "set", value: "Summary" }],
    });
    await Promise.all([
      manager.execute(
        first.operationId,
        first.previewHash,
        first.confirmationPhrase,
      ),
      manager.execute(
        second.operationId,
        second.previewHash,
        second.confirmationPhrase,
      ),
    ]);
    expect(maxActive).toBe(1);
  });
});
