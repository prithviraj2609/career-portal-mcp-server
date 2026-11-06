# Contributor architecture guide

## Layers

1. `tools.ts` defines bounded MCP schemas and maps calls to services.
2. `service.ts` provides provider-neutral operations.
3. `providers/provider.ts` defines the adapter contract.
4. Public adapters normalize LinkedIn guest HTML. Naukri search uses a fresh
   anonymous Playwright context to observe the provider page's own
   `/jobapi/v3/search` response; it never reuses authenticated account state.
   Naukri detail pages continue to use public JSON-LD where available. The
   default server leaves Naukri search disabled while the provider returns HTTP
   403 to legitimate anonymous Chromium access; rotating state is not copied or
   bypassed.
5. `providers/browser-enabled.ts` adds opt-in authenticated capabilities.
6. `browser/session-manager.ts` owns encrypted session lifecycle.
7. Provider workflows contain all selectors and UI actions.
8. `mutations.ts` owns preview binding, expiry, confirmation, replay defense,
   drift detection, per-provider serialization, and audit outcomes.
9. `security.ts`, `http.ts`, and `rate-limiter.ts` provide shared controls.

No generic browser tool is exposed. Provider workflows receive a deliberately
small browser interface and can navigate only to hard-coded provider pages.

## Adding or changing an adapter

- Prefer a documented official API. Mark public HTML or browser support as
  high fragility.
- Publish accurate capabilities; unsupported operations must fail explicitly.
- Normalize provider output in shared domain types.
- Keep provider selectors in one workflow file.
- Use exact action selectors. Reads may intentionally return multiple values;
  writes must never pick the first ambiguous match.
- Detect login, CAPTCHA, MFA, and challenges before reads and after each write.
- Validate every field before opening UI.
- Re-read all previewed fields immediately before execution.
- Do not retry writes with uncertain outcomes.
- Never log page HTML, cookies, storage state, resume content, or field values.

## Selector fixture workflow

1. Capture the smallest sanitized markup needed to represent a provider page.
2. Remove names, emails, IDs, tokens, tracking values, and resume data.
3. Add a fixture-based test using the `BrowserPage` abstraction.
4. Test successful reads, unique actions, ambiguity, missing selectors,
   challenges, authentication expiry, and post-save verification failure.
5. Never record or replay a real user's browser session in tests.

## Mutation semantics

Preview records are process-memory only. The hash binds:

- operation UUID;
- expiry timestamp;
- provider and mutation kind;
- exact requested field operations and values;
- hash of current provider state.

Execution consumes the record before validation, making every attempt
single-use. Same-provider writes serialize. Multi-field browser mutations are
not transactional; errors after a completed field report `OUTCOME_UNKNOWN`
with completed field names. Callers must re-read rather than retry.

## Capability boundaries

Both providers support public details and opt-in profile, skills,
latest education, and job-preference reads/updates. Naukri
reads its complete ordered employment history from the profile SPA's approved
same-origin `/users/self` response and targets writes by stable employment ID.
Naukri
also supports resume read/replacement. LinkedIn resume replacement,
visibility/contact settings, saved jobs, applications, and messaging remain
unsupported.
