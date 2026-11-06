import { z } from "zod";

export const providerSchema = z.enum(["linkedin", "naukri"]);

export const searchJobsSchema = z.object({
  provider: providerSchema,
  query: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(120).optional(),
  remoteMode: z.enum(["on_site", "hybrid", "remote"]).optional(),
  postedWithinDays: z.number().int().min(1).max(30).optional(),
  pageToken: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

export const jobDetailsSchema = z.object({
  provider: providerSchema,
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
});

export const accountReadSchema = z.object({
  provider: providerSchema,
  kind: z.enum([
    "profile",
    "resume",
    "skills",
    "experience",
    "education",
    "job_preferences",
    "visibility_contact_settings",
    "saved_jobs",
    "recommended_jobs",
    "applications",
    "recruiter_messages",
  ]),
});

const fieldChangeSchema = z
  .object({
    field: z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,159}$/),
    operation: z.enum(["set", "remove"]),
    value: z.unknown().optional(),
  })
  .superRefine((change, context) => {
    if (change.operation === "set" && change.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value is required for set operations",
        path: ["value"],
      });
    }
    if (change.operation === "remove" && change.value !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value must be omitted for remove operations",
        path: ["value"],
      });
    }
  });

export const mutationPreviewSchema = z.object({
  provider: providerSchema,
  kind: z.enum([
    "profile",
    "resume",
    "skills",
    "experience",
    "education",
    "job_preferences",
    "visibility_contact_settings",
    "save_job",
    "application",
    "message",
  ]),
  changes: z.array(fieldChangeSchema).min(1).max(25),
});

export const mutationExecuteSchema = z.object({
  operationId: z.string().uuid(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmation: z.string().min(1).max(200),
});
