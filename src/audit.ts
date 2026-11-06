import { randomUUID } from "node:crypto";
import { redact } from "./security.js";

export interface AuditEvent {
  event: string;
  provider?: string;
  operation?: string;
  outcome: "allowed" | "denied" | "success" | "failure";
  details?: Record<string, unknown>;
}

export interface AuditSink {
  write(event: AuditEvent): void;
}

export class StderrAuditSink implements AuditSink {
  write(event: AuditEvent): void {
    const safeEvent = redact(event) as Record<string, unknown>;
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        auditId: randomUUID(),
        ...safeEvent,
      })}\n`,
    );
  }
}
