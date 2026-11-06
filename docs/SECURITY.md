# Security, privacy, and provider constraints

## Threat model

CareerPortalMCP processes public job data and, when explicitly enabled,
sensitive account/profile data. Primary threats include:

- theft of browser cookies or local storage;
- accidental logging of credentials, resumes, contact data, or tokens;
- unauthorized or replayed mutations;
- stale previews overwriting newer provider state;
- selector drift editing the wrong UI field;
- malicious resume paths or disguised file types;
- provider redirects to untrusted hosts;
- CAPTCHA/MFA bypass attempts;
- partial writes after provider or network failure;
- excessive requests triggering provider controls.

## Controls

- Passwords are entered only into headed provider pages and are never MCP tool
  arguments.
- Browser storage state is encrypted with AES-256-GCM using a random 96-bit IV,
  authenticated format version, and atomic restrictive writes.
- Stored cookies are restricted to the selected provider domain. Persisted
  origins and every final browser URL must be HTTPS on that provider domain or
  a provider subdomain; unexpected origins fail closed before load or save.
- The secure launcher reads a user-only key file; examples never place the key
  in MCP configuration.
- Audit records redact authorization, cookies, tokens, passwords, sessions,
  resumes, contacts, email, and phone fields.
- Mutations are disabled by default and require an enabled provider capability,
  a state-bound preview, exact confirmation phrase, and unexpired single-use
  operation.
- Execution re-reads provider state and rejects drift. Writes serialize per
  provider.
- Selectors used for actions must match exactly one element.
- Submitted field values and resume filenames are re-read from the provider and
  compared with the requested normalized state before success is reported.
- Ambiguous or partially verified writes return `OUTCOME_UNKNOWN`; callers
  must re-read before retrying.
- CAPTCHA, MFA, login challenges, and expired authentication fail closed.
- Naukri resumes must remain under the configured realpath directory and pass
  extension, magic-byte, non-empty, and size checks.
- Public result URLs are restricted to HTTPS LinkedIn/Naukri hosts.
- Naukri public search runs in a fresh anonymous browser context without stored
  account cookies. Only the exact provider-origin `/jobapi/v3/search` JSON
  response is accepted; copied or hard-coded browser tokens are not used.
- Authenticated Naukri account operations use a visible headed provider window
  because headless profile access receives HTTP 403 challenges. The MCP never
  attempts to conceal automation or bypass that challenge.
- Public GETs have explicit timeouts, result caps, provider rate limits, and
  bounded retry/backoff. Every retry consumes a separate local rate-limit token.

## Local data

Operators choose all state paths. Recommended locations:

| Data | Windows | macOS/Linux |
|---|---|---|
| Key | `%USERPROFILE%\\.career-portal-mcp\\session.key` | `~/.career-portal-mcp/session.key` |
| Encrypted session | `%USERPROFILE%\\.career-portal-mcp\\sessions.enc` | `~/.career-portal-mcp/sessions.enc` |
| Resumes | `%USERPROFILE%\\.career-portal-mcp\\resumes` | `~/.career-portal-mcp/resumes` |

The key and encrypted session must not be synchronized to shared drives,
checked into source control, attached to support tickets, or copied into chat.
Resumes remain user-managed files and may contain sensitive personal data.

## Residual risks

- Provider UI selectors and public guest endpoints are undocumented and can
  change without notice.
- UI automation may be disallowed by provider terms, account policies, or
  applicable law. Obtain approval before enabling.
- Encryption protects data at rest, not a compromised logged-in operating
  system account.
- File signature checks are not malware scanning.
- Provider saves may complete even when confirmation markup fails to load;
  these cases return `OUTCOME_UNKNOWN`.
- Local logout does not revoke provider-side sessions.

## Incident response

On suspected session or key compromise:

1. Stop the MCP server.
2. Revoke sessions in both provider account-security pages.
3. Delete the encrypted state and key.
4. Generate a new key and login again.
5. Review redacted audit metadata and operating-system access logs.
6. Do not retry an `OUTCOME_UNKNOWN` mutation until provider state is read.

Report security issues through the repository's private security process, not a
public issue containing account data.
