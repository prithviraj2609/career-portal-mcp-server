import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { AuditSink } from "./audit.js";
import { CareerPortalError } from "./errors.js";
import type { ProviderAdapter } from "./providers/provider.js";
import type {
  MutationPreview,
  MutationRequest,
  ProviderName,
} from "./types.js";

interface PendingMutation {
  request: MutationRequest;
  previewHash: string;
  stateHash: string;
  confirmationPhrase: string;
  expiresAt: number;
}

export class MutationManager {
  private readonly pending = new Map<string, PendingMutation>();
  private readonly providerLocks = new Map<ProviderName, Promise<void>>();

  constructor(
    private readonly enabled: boolean,
    private readonly ttlMs: number,
    private readonly providers: Map<ProviderName, ProviderAdapter>,
    private readonly audit: AuditSink,
    private readonly now: () => number = Date.now,
  ) {}

  async preview(request: MutationRequest): Promise<MutationPreview> {
    if (!this.enabled) {
      this.audit.write({
        event: "mutation_preview",
        provider: request.provider,
        operation: request.kind,
        outcome: "denied",
        details: { reason: "mutations_disabled" },
      });
      throw new CareerPortalError(
        "MUTATION_DISABLED",
        "Mutations are disabled. Set CAREER_PORTAL_MUTATIONS_ENABLED=true only after provider approval and review.",
      );
    }
    validateChanges(request);
    const provider = this.providers.get(request.provider);
    const operation = mutationOperation(request.kind);
    const capability = provider
      ?.capabilities()
      .find((item) => item.operation === operation && item.mutation);
    if (!provider || !capability?.enabled) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        `${request.provider} does not expose enabled capability ${operation}`,
      );
    }

    const currentState = await provider.readMutationState(request);
    if (isNoOp(request, currentState)) {
      this.audit.write({
        event: "mutation_preview",
        provider: request.provider,
        operation: request.kind,
        outcome: "denied",
        details: { reason: "no_changes" },
      });
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Requested values already match current provider state",
      );
    }
    const operationId = randomUUID();
    const expiresAt = this.now() + this.ttlMs;
    const stateHash = hashValue(currentState);
    const previewHash = hashValue({
      operationId,
      expiresAt,
      request,
      stateHash,
    });
    const confirmationPhrase = `CONFIRM ${operationId}`;
    this.pending.set(operationId, {
      request,
      previewHash,
      stateHash,
      confirmationPhrase,
      expiresAt,
    });
    this.audit.write({
      event: "mutation_preview",
      provider: request.provider,
      operation: request.kind,
      outcome: "allowed",
      details: {
        operationId,
        fields: request.changes.map((change) => change.field),
      },
    });
    return {
      operationId,
      previewHash,
      provider: request.provider,
      kind: request.kind,
      changes: request.changes.map((change) => ({
        ...change,
        ...(currentState[change.field] === undefined
          ? {}
          : { before: currentState[change.field] }),
      })),
      warnings: [
        "Execution changes provider state and requires fresh explicit user confirmation.",
      ],
      confirmationPhrase,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async execute(
    operationId: string,
    previewHash: string,
    confirmation: string,
  ): Promise<unknown> {
    const pending = this.pending.get(operationId);
    this.pending.delete(operationId);
    if (!pending || pending.expiresAt <= this.now()) {
      throw new CareerPortalError(
        "CONFIRMATION_REQUIRED",
        "Mutation preview is missing or expired; create a new preview",
      );
    }
    if (
      !safeEqual(previewHash, pending.previewHash) ||
      !safeEqual(confirmation, pending.confirmationPhrase)
    ) {
      throw new CareerPortalError(
        "CONFIRMATION_REQUIRED",
        "Confirmation does not exactly match the unexpired preview",
      );
    }
    const provider = this.providers.get(pending.request.provider);
    if (!provider) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        `Unknown provider ${pending.request.provider}`,
      );
    }
    return this.withProviderLock(pending.request.provider, async () => {
      try {
        const currentState = await provider.readMutationState(pending.request);
        if (!safeEqual(hashValue(currentState), pending.stateHash)) {
          throw new CareerPortalError(
            "STATE_DRIFT",
            "Provider state changed after preview; review a new diff before applying",
          );
        }
        const result = await provider.executeMutation(pending.request);
        this.audit.write({
          event: "mutation_execute",
          provider: pending.request.provider,
          operation: pending.request.kind,
          outcome: "success",
          details: { operationId },
        });
        return result;
      } catch (error: unknown) {
        this.audit.write({
          event: "mutation_execute",
          provider: pending.request.provider,
          operation: pending.request.kind,
          outcome: "failure",
          details: {
            operationId,
            error:
              error instanceof CareerPortalError ? error.code : "PROVIDER_ERROR",
          },
        });
        throw error;
      }
    });
  }

  private async withProviderLock<T>(
    provider: ProviderName,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.providerLocks.get(provider) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.providerLocks.set(provider, tail);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.providerLocks.get(provider) === tail) {
        this.providerLocks.delete(provider);
      }
    }
  }
}

function validateChanges(request: MutationRequest): void {
  const seen = new Set<string>();
  for (const change of request.changes) {
    if (seen.has(change.field)) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `Duplicate field change: ${change.field}`,
      );
    }
    seen.add(change.field);
    if (change.field.toLowerCase().includes("password")) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Password fields are never accepted",
      );
    }
    if (
      change.operation === "set" &&
      typeof change.value === "string" &&
      change.value.length > 20_000
    ) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `${change.field} exceeds the maximum value length`,
      );
    }
  }
}

function mutationOperation(kind: MutationRequest["kind"]): string {
  if (kind === "application") return "apply_to_job";
  if (kind === "message") return "send_message";
  if (kind === "save_job") return "save_job";
  return `update_${kind}`;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isNoOp(
  request: MutationRequest,
  currentState: Record<string, unknown>,
): boolean {
  return request.changes.every((change) => {
    if (change.field === "resume.path") return false;
    const current = currentState[change.field];
    if (change.operation === "remove") {
      return current === undefined || current === null || current === "";
    }
    return JSON.stringify(current) === JSON.stringify(change.value);
  });
}
