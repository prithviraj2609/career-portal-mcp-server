# Career Portal MCP Server

First-party MCP server for bounded public job discovery across LinkedIn and
Naukri. It provides a provider-neutral model, explicit capability discovery,
safe account-operation interfaces, encrypted session storage abstractions, and
a fail-closed mutation preview/confirmation framework.

No third-party MCP implementation or source is used.

## Documentation

- [Installation and MCP client configuration](docs/INSTALLATION.md)
- [Security, privacy, and threat model](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Testing guide](docs/TESTING.md)
- [Contributor architecture](docs/ARCHITECTURE.md)
- [Release checklist](docs/RELEASE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Current support

| Operation | LinkedIn | Naukri |
|---|---|---|
| Job search | Public guest HTML endpoint; high fragility | Authenticated headed browser; anonymous access remains disabled after HTTP 403 |
| Public job details | Public guest HTML; high fragility | Public HTML JSON-LD; high fragility |
| Profile/skills/experience/education reads | Complete entity histories with stable LinkedIn IDs | Opt-in Playwright adapter |
| Resume read/replacement | Unsupported | Opt-in Playwright adapter |
| Job-preference reads | Opt-in Playwright adapter | Opt-in Playwright adapter |
| Profile/resume/preferences updates | Opt-in Playwright adapter plus mutation gate | Opt-in Playwright adapter plus mutation gate |
| Visibility/contact settings | Authenticated contact-info read | Unsupported |
| Recommendations/saved jobs/application history | Authenticated recommendations, saved jobs, and job-tracker Applied tab | Authenticated read-only browser adapter |
| Recruiter messages | Authenticated conversation summaries; opening messaging may update provider read state | Authenticated read-only browser adapter |
| Send recruiter message | Existing writable LinkedIn threads only; mutation gate plus exact confirmation | Unsupported |
| Save/unsave | Mutation gate plus exact confirmation | Mutation gate plus exact confirmation |
| Apply | Unsupported | Direct Naukri applications only; mutation gate plus exact confirmation |

The public web surfaces used for discovery are not guaranteed APIs. Their HTML,
availability, permitted use, and rate limits can change without notice. Review
the providers' current terms, robots directives, and applicable law before
deployment. The server does not bypass CAPTCHAs, login walls, consent screens,
or anti-bot challenges. It stops with `ANTI_BOT_CHALLENGE`.

## Tools

Read-only:

- `discover_provider_capabilities`
- `get_browser_auth_status`
- `start_browser_login`
- `complete_browser_login`
- `logout_browser_session`
- `search_jobs`
- `search_linkedin_jobs`
- `search_naukri_jobs`
- `get_job_details`
- `read_account_data`

Mutation preview interfaces:

- `preview_profile_update`
- `preview_resume_update`
- `preview_skills_update`
- `preview_experience_update`
- `preview_education_update`
- `preview_job_preferences_update`
- `preview_visibility_contact_update`
- `preview_save_job`
- `preview_application_submission`
- `execute_confirmed_mutation`

All mutation previews fail with `MUTATION_DISABLED` by default. Enabling the
global flag is not enough: the selected provider browser adapter must also be
enabled and authenticated. Questionnaire, cover-letter, alternate-resume,
external-company application, message, visibility/contact, and other unlisted
provider operations remain unsupported.

The browser mutation adapter uses a two-step flow. Preview first reads current
provider state and returns explicit before/after field values, a state-bound
SHA-256 preview hash, exact
confirmation phrase, and expiry.
Execution accepts only the operation ID, exact hash, and exact phrase. Previews
are short-lived and single-use, including after a failed confirmation. MCP
clients must obtain fresh explicit user approval immediately before every
execute call; blanket or remembered consent is not valid. Execution re-reads
the same fields and returns `STATE_DRIFT` without writing if they changed.
Already-current values are rejected as a no-op without opening an edit form.

## Local setup

Requires Node.js 22 or later.

```powershell
Set-Location src\career-portal-mcp
npm install
npx playwright install chromium
npm run build
node dist\index.js
```

Development:

```powershell
Set-Location src\career-portal-mcp
npm install
npm run dev
```

For a public-search-only local process, run:

```powershell
node dist\index.js
```

For MCP clients and authenticated browser features, use the secure launcher.
Create the state directory and key as documented in
`docs/INSTALLATION.md`, then configure the client with absolute paths:

```json
{
  "mcpServers": {
    "career-portal": {
      "command": "node",
      "args": [
        "C:\\absolute\\path\\to\\career-portal-mcp-server\\dist\\secure-launcher.js"
      ],
      "env": {
        "CAREER_PORTAL_SESSION_KEY_FILE": "C:\\absolute\\state\\path\\session.key",
        "CAREER_PORTAL_SESSION_FILE": "C:\\absolute\\state\\path\\sessions.enc",
        "CAREER_PORTAL_RESUME_DIRECTORY": "C:\\absolute\\state\\path\\resumes",
        "CAREER_PORTAL_MUTATIONS_ENABLED": "false",
        "CAREER_PORTAL_LINKEDIN_BROWSER_ENABLED": "true",
        "CAREER_PORTAL_NAUKRI_BROWSER_ENABLED": "true",
        "CAREER_PORTAL_REQUEST_TIMEOUT_MS": "10000",
        "CAREER_PORTAL_READS_PER_MINUTE": "15",
        "CAREER_PORTAL_MAX_RESULTS": "25",
        "CAREER_PORTAL_MUTATION_CONFIRMATION_TTL_MS": "300000",
        "CAREER_PORTAL_USER_AGENT": "CareerPortalMCP/0.1 support@example.com"
      }
    }
  }
}
```

Restart the MCP client after adding the configuration. Then call
`start_browser_login`, complete login and MFA only in the provider window, and
call `complete_browser_login`. Keep mutations disabled until authentication
and read-only smoke tests succeed.

## Configuration and security

See `.env.example` for all variables. Defaults cap tool results at 25, provider
reads at 20/minute per hostname, and requests at 10 seconds. Retry is limited to
idempotent GET requests for HTTP 429/5xx, honors `Retry-After`, and uses bounded
exponential backoff with jitter.

Account credentials are never accepted as tool arguments. `SessionStore`
supports in-memory storage and AES-256-GCM encrypted file persistence. To use
the encrypted store, set both `CAREER_PORTAL_SESSION_FILE` and a 32-byte base64
`CAREER_PORTAL_SESSION_KEY`; keep the key in an OS credential vault or managed
secret service, not in source control. A production provider OAuth adapter
should use PKCE, least-privilege scopes, revocation, and the encrypted store.
Browser adapters require the encrypted store and refuse startup without both
session variables. Manual login opens only the selected provider login URL in a
headed Chromium window. Users enter passwords and MFA directly into the
provider UI; CareerPortalMCP never receives or logs them. On completion,
Playwright storage state is encrypted at rest. Background reads and mutations
load that state into an isolated browser context and close it after each
operation.

Audit records go to stderr so they cannot corrupt stdio MCP messages. Sensitive
keys including authorization, cookies, tokens, sessions, resumes, email, phone,
and contact data are recursively redacted. Audit records capture operation
metadata and field names, not field values.

## Provider and failure behavior

Use `discover_provider_capabilities` before other operations. Capability output
distinguishes public web, official API, authenticated session, local-only, and
unsupported operations. Unsupported account functionality returns
`CAPABILITY_UNAVAILABLE`; it never returns success-shaped placeholder data.

Typed errors include `AUTH_REQUIRED`, `SCOPE_REQUIRED`,
`CAPABILITY_UNAVAILABLE`, `MUTATION_DISABLED`, `CONFIRMATION_REQUIRED`,
`VALIDATION_FAILED`, `RATE_LIMITED`, `ANTI_BOT_CHALLENGE`, `STATE_DRIFT`,
`PROVIDER_CHANGED`, `TIMEOUT`, `OUTCOME_UNKNOWN`, and `PROVIDER_ERROR`.

The Naukri detail URL cannot always be reconstructed from a provider ID alone.
The current adapter supports details when the public detail response contains a
matching JSON-LD identifier; provider layout or routing changes are reported as
`PROVIDER_CHANGED`.

Use `logout_browser_session` to delete one provider's local encrypted session.
It does not revoke the provider-side session; use the provider security page
for remote revocation.

## Opt-in personal account adapter

Generate a key outside the repository, choose a local encrypted-state file, and
enable providers independently:

```powershell
Set-Location src\career-portal-mcp
npm install
npx playwright install chromium
npm run build

$keyBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($keyBytes)
$env:CAREER_PORTAL_SESSION_KEY = [Convert]::ToBase64String($keyBytes)
$env:CAREER_PORTAL_SESSION_FILE = "$env:LOCALAPPDATA\CareerPortalMCP\sessions.enc"
$env:CAREER_PORTAL_RESUME_DIRECTORY = "$env:USERPROFILE\Documents\Resumes"
$env:CAREER_PORTAL_LINKEDIN_BROWSER_ENABLED = 'true'
$env:CAREER_PORTAL_NAUKRI_BROWSER_ENABLED = 'true'
# Enable only after reviewing the current provider UI and terms:
$env:CAREER_PORTAL_MUTATIONS_ENABLED = 'true'
node dist\index.js
```

Persist the generated key in an OS credential vault before closing the shell.
Changing or losing it makes the encrypted session file unreadable. The resume
directory is mandatory for the Naukri adapter; resume uploads are confined to
real files inside that directory, including after symbolic-link resolution.

Call `start_browser_login` for one provider, complete login and MFA manually,
then call `complete_browser_login`. If CAPTCHA, MFA, verification, login expiry,
or selector drift is detected, the operation stops; it never attempts bypass.

Example manual login calls:

```json
{"name":"start_browser_login","arguments":{"provider":"linkedin"}}
{"name":"complete_browser_login","arguments":{"provider":"linkedin"}}
{"name":"get_browser_auth_status","arguments":{"provider":"linkedin"}}
```

Run a read-only smoke test before enabling mutations:

```json
{"name":"discover_provider_capabilities","arguments":{"provider":"linkedin"}}
{"name":"search_linkedin_jobs","arguments":{"query":"platform engineer","location":"Bengaluru","limit":5}}
{"name":"read_account_data","arguments":{"provider":"linkedin","kind":"profile"}}
```

Additional examples:

```json
{"name":"search_naukri_jobs","arguments":{"query":"site reliability engineer","location":"Pune","postedWithinDays":7,"limit":10}}
{"name":"get_job_details","arguments":{"provider":"naukri","jobId":"<PROVIDER_JOB_ID>"}}
{"name":"read_account_data","arguments":{"provider":"naukri","kind":"skills"}}
{"name":"read_account_data","arguments":{"provider":"naukri","kind":"resume"}}
{"name":"read_account_data","arguments":{"provider":"naukri","kind":"recommended_jobs"}}
{"name":"read_account_data","arguments":{"provider":"naukri","kind":"saved_jobs"}}
{"name":"read_account_data","arguments":{"provider":"naukri","kind":"applications"}}
{"name":"read_account_data","arguments":{"provider":"naukri","kind":"recruiter_messages"}}
```

For a mutation smoke test, first call a preview tool. Review every `before` and
new value in its response. Only after the user explicitly approves that exact
diff, pass the returned values unchanged to the execute tool:

```json
{"name":"preview_profile_update","arguments":{"provider":"linkedin","changes":[{"field":"headline","operation":"set","value":"Principal Platform Engineer"}]}}
{"name":"execute_confirmed_mutation","arguments":{"operationId":"<returned-operationId>","previewHash":"<returned-previewHash>","confirmation":"<returned-confirmationPhrase>"}}
```

Skills and Naukri resume previews:

```json
{"name":"preview_skills_update","arguments":{"provider":"linkedin","changes":[{"field":"skills","operation":"set","value":["TypeScript","Distributed Systems"]}]}}
{"name":"preview_resume_update","arguments":{"provider":"naukri","changes":[{"field":"resume.path","operation":"set","value":"<ABSOLUTE_PATH_INSIDE_RESUME_DIRECTORY>"}]}}
```

LinkedIn authenticated account reads use the current SDUI profile cards and
the dedicated experience, education, and skills pages. Account operations run
in a headed provider window because the current profile sections are
progressively rendered and headless reads can omit valid data. Authenticated
job details use `/jobs/view/<numeric-id>/` and return the provider-rendered
title, company, location, full description, and Apply URL.

LinkedIn save/unsave uses the same confirmation gate as Naukri:

```json
{"name":"preview_save_job","arguments":{"provider":"linkedin","changes":[{"field":"job.<NUMERIC_JOB_ID>.saved","operation":"set","value":{"sourceUrl":"https://www.linkedin.com/jobs/view/<NUMERIC_JOB_ID>/","saved":true}}]}}
```

LinkedIn authenticated reads also expose recommended jobs, saved jobs,
ID-bearing conversation summaries from Messaging, Open to Work titles/locations, and the
profile Contact info dialog. Messaging navigation can cause LinkedIn to update
delivery or seen state; it should not be treated as a strictly side-effect-free
read. Applied jobs are read from the current job tracker's `Applied` view.

`recruiter_messages` returns bounded existing conversations with `id`,
`recipient`, `threadUrl`, and `writable`. Sending is limited to an existing
writable thread; the server does not search for arbitrary people or create
unsolicited conversations. The exact thread ID, URL, recipient label, and
message text are bound into the preview:

```json
{"name":"preview_message_send","arguments":{"provider":"linkedin","changes":[{"field":"message.<THREAD_ID>.send","operation":"set","value":{"threadUrl":"https://www.linkedin.com/messaging/thread/<THREAD_ID>/","recipient":"Exact recipient label from recruiter_messages","text":"I am interested in the role and would like to learn more."}}]}}
```

Execution requires the exact unexpired confirmation returned by the preview,
rechecks that the active thread still matches the recipient, and reports
`OUTCOME_UNKNOWN` unless the exact sent text appears in that thread. Reading
conversations may update LinkedIn seen state.

LinkedIn external-company Apply links and Easy Apply questionnaires are not
submitted. Resume management, message mutations, and visibility/contact
mutations remain unsupported until their current first-party editors are
separately mapped and tested.

LinkedIn employment and education mutations use the stable numeric ID returned
in `employment.history` or `education.history`. Exactly one entity mutation is
allowed per preview:

```json
{"name":"preview_experience_update","arguments":{"provider":"linkedin","changes":[{"field":"employment.add","operation":"set","value":{"title":"Principal Engineer","company":"Example","startMonth":1,"startYear":"2024","current":true}}]}}
{"name":"preview_experience_update","arguments":{"provider":"linkedin","changes":[{"field":"employment.<ID>","operation":"set","value":{"title":"Staff Engineer","location":"Bengaluru","description":"Built distributed systems."}}]}}
{"name":"preview_experience_update","arguments":{"provider":"linkedin","changes":[{"field":"employment.<ID>","operation":"remove"}]}}
{"name":"preview_education_update","arguments":{"provider":"linkedin","changes":[{"field":"education.add","operation":"set","value":{"school":"Example University","degree":"Master of Engineering","fieldOfStudy":"Computer Science"}}]}}
{"name":"preview_education_update","arguments":{"provider":"linkedin","changes":[{"field":"education.<ID>","operation":"remove"}]}}
```

Employment values support `title`, `company`, `location`, `description`,
`locationType`, `employmentType`, `startMonth`, `startYear`, `current`,
`endMonth`, and `endYear`. Previous roles require both end fields. Education
values support `school`, `degree`, `fieldOfStudy`, `description`, and start/end
month/year.

LinkedIn does not expose skill renaming. Skills therefore use separately
confirmed add and delete operations:

```json
{"name":"preview_skills_update","arguments":{"provider":"linkedin","changes":[{"field":"skill.add","operation":"set","value":"Distributed Systems"}]}}
{"name":"preview_skills_update","arguments":{"provider":"linkedin","changes":[{"field":"skill.<ID>","operation":"remove"}]}}
```

Preview records are memory-only, expire after five minutes by default, bind the
operation ID, expiry, requested changes, and provider-state hash, and are
single-use even after a failed confirmation. Execution serializes writes per
provider, re-reads current state, and rejects drift before opening edit UI.

Both provider workflows currently implement these normalized fields:

| Area | Fields |
|---|---|
| Intro | `headline`, `summary` |
| Skills | LinkedIn: `skills` and ID-bearing `skill.history`; Naukri: `skills` |
| Employment | LinkedIn and Naukri: ordered `employment.history` plus latest-entry aliases |
| Projects | Naukri: `project.history`, including the attached employment ID |
| Education | LinkedIn: ID-bearing `education.history` plus latest-entry aliases; Naukri: latest aliases and provider history |
| Job preferences | `jobPreferences.titles`, `jobPreferences.locations` |
| Resume | Naukri only: `resume.current` read and `resume.path` PDF/DOC/DOCX replacement |

Naukri employment entries expose stable IDs in `employment.history`. Use those
IDs in confirmed experience previews:

- Add an entry with `employment.add` and a validated object containing
  `company`, `title`, `startDate` (`YYYY-MM`), `current`, and
  `employmentType` (`full_time` or `internship`). Previous roles require
  `endDate`; current roles may also include `description`, `skills`, and a
  paired `salary`/`currency` (`INR` or `USD`).
- Replace `employment.<id>.title`, `.company`, `.description`,
  `.employmentType`, `.skills`, `.salary`, or `.noticePeriod`. Salary replacement uses
  `{"amount":"2500000","currency":"INR"}`.
- Replace `employment.<id>.dates` atomically with `startDate`, `current`, and
  `endDate` when the role is not current.
- Remove `employment.<id>` to delete an entry.
- Add an attached project with `project.add`, update
  `project.<id>.title`/`.description`, or remove `project.<id>`.
- Add an IT skill with `itSkill.add`, or replace an existing entry with
  `itSkill.<id>`. Values contain `skill`, optional `version`, `lastUsedYear`,
  `experienceYears`, and `experienceMonths`. Naukri currently caps the profile
  at ten IT skills, and deletion remains unsupported because no reliable
  delete control is exposed by the current editor.
- Add higher education with `education.add`, replace an entry with
  `education.<id>`, or remove `education.<id>`. Set values contain `level`,
  `institute`, `course`, optional `specialization`, `courseType`
  (`full_time`, `part_time`, or `correspondence`), `startYear`,
  `completionYear`, and optional `gradingSystem`. School records are excluded
  from mutation indexing to avoid confusing them with higher education.
- Add a certification with `certification.add`, replace an entry with
  `certification.<id>`, or remove `certification.<id>`. Set values contain
  `name`, `provider`, optional `completionId`, optional `url`, `issueDate`
  (`YYYY-MM`), optional `expiryDate`, and `doesNotExpire`. Expiring
  certifications require an expiry date; non-expiring ones reject it.

Naukri has no independent employment reorder control. Its UI derives order
from current status and dates, so date/status changes are the supported reorder
mechanism. Every change still requires preview, exact unexpired confirmation,
fresh-state drift checking, and post-submit API verification.

Naukri career-profile updates use the `careerProfile` field through
`preview_job_preferences_update`. The value may include one or more of
`industry`, `department`, `roleCategory`, `role`, `jobTypes`
(`permanent`/`contractual`), and `employmentTypes`
(`full_time`/`part_time`). Only mapped provider controls are changed and the
result is re-read before success is reported.

Example preview only (it does not write):

```json
{"name":"preview_experience_update","arguments":{"provider":"naukri","changes":[{"field":"employment.add","operation":"set","value":{"company":"Example","title":"Senior Engineer","startDate":"2024-09","current":true,"employmentType":"full_time","description":"Platform engineering","skills":["TypeScript"],"salary":"2500000","currency":"INR"}}]}}
```

Authenticated job mutation previews:

```json
{"name":"preview_save_job","arguments":{"provider":"naukri","changes":[{"field":"job.<JOB_ID>.saved","operation":"set","value":{"sourceUrl":"https://www.naukri.com/<JOB_PATH>","saved":true}}]}}
{"name":"preview_application_submission","arguments":{"provider":"naukri","changes":[{"field":"application.<JOB_ID>.submission","operation":"set","value":{"sourceUrl":"https://www.naukri.com/<JOB_PATH>","resume":"current","questionnaireAnswers":{}}}]}}
```

Application execution clicks the exact provider Apply control only after
confirmation and reports success only when the job subsequently appears in
application history. If the provider requires questionnaire answers, a cover
letter, alternate resume selection, or an external-company flow, execution
fails closed without attempting additional controls. An inconclusive first
Apply action returns `OUTCOME_UNKNOWN` and must be reconciled against
application history before retrying.

`recruiter_messages` reads the first bounded page (up to 20 entries) from the
authenticated Naukri inbox response. It returns message IDs, timestamps,
read state, sender/recruiter and company metadata, subject/title, associated
job metadata, and application/interest state. Message bodies, pagination,
mark-read, reply, delete, and send operations are intentionally unsupported;
no messaging mutation capability is advertised.

Resume files must be non-empty, use an allowed extension, and remain under
`CAREER_PORTAL_RESUME_MAX_BYTES` (5 MiB by default). PDF, legacy DOC, and DOCX
magic bytes must match the extension. Full MIME/content scanning is not
performed, so deployments should add an approved malware scanner before
uploading untrusted documents.

Naukri employment history also returns provider location, department, role
category, and role values when present. The current employment editor does not
expose reliable controls for those provider-derived fields, so they remain
read-only rather than being guessed. Naukri exposes only a total salary and
INR/USD selector in this editor; no additional salary-breakdown mutation is
claimed.

Naukri account operations use a headed provider window because legitimate
headless profile requests receive HTTP 403 verification challenges. Reads use
the profile page's own approved same-origin `/users/self` JSON response; writes
use the visible provider editors and re-read the API after submission.

LinkedIn and Naukri selectors are isolated in
`src/browser/linkedin-workflow.ts` and `src/browser/naukri-workflow.ts`.
Provider UI automation is inherently high-fragility and may violate current
provider terms in some jurisdictions or account tiers. Validate selectors and
obtain legal/provider approval before enabling. The adapter does not implement
LinkedIn resume replacement, skill renaming (use separate delete and add),
visibility/contact mutations, new-recipient message composition,
external-company applications, or
Naukri questionnaire/cover-letter/alternate-resume submission. Unsupported
operations fail validation rather than guessing provider semantics.

## Dependency advisory status

The resolved runtime tree is `@modelcontextprotocol/sdk@1.32.1` (including
`express@5.2.1`, `body-parser@2.3.0`, `qs@6.16.0`, and `hono@4.13.13`),
`playwright@1.63.0`, and `zod@3.25.76`. Development tooling includes
`vite@7.3.7` and `esbuild@0.28.2` through Vitest.

An online `npm install` reported one moderate and two critical advisories but
did not include their identities. The locally available
`npm audit --offline --json` cache reports zero advisories. Because registry
audit details were not authorized/available, this discrepancy is unresolved;
the project does not claim advisory clearance or attribute the three findings
to a package without evidence.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```
