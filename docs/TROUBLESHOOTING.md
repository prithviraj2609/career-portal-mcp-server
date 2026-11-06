# Troubleshooting

| Error/status | Meaning | Safe action |
|---|---|---|
| `AUTH_REQUIRED` | Session missing or expired | Run headed manual login again |
| `ANTI_BOT_CHALLENGE` | CAPTCHA, MFA, verification, or challenge detected | Complete it manually; do not automate bypass |
| Naukri public search unavailable | Anonymous Chromium receives HTTP 403 before the provider search API response | Treat public search as unsupported; do not copy rotating `Nkparam` or private headers |
| `PROVIDER_CHANGED` | Expected public markup or a unique selector changed | Disable mutations and update fixtures/selectors |
| `STATE_DRIFT` | Profile changed after preview | Generate and review a new preview |
| `OUTCOME_UNKNOWN` | A save may have completed or a multi-field update stopped part-way | Read provider state before any retry |
| `RATE_LIMITED` | Local or provider request budget exhausted | Honor retry guidance and reduce frequency |
| `TIMEOUT` | Provider did not respond before the explicit deadline | Retry a read; do not blindly retry a mutation |
| `MUTATION_DISABLED` | Global mutation flag is false | Enable only after read-only validation and approval |
| `CAPABILITY_UNAVAILABLE` | Adapter/provider does not support the operation | Do not treat it as success or attempt a workaround |

## Chromium does not start

Run `npx playwright install chromium` from the package directory. On Linux,
use `npx playwright install --with-deps chromium` when system libraries are
missing. Login requires a desktop display.

## Session cannot be decrypted

The key file must be the same 32-byte base64 value used when the session file
was created. If the key was lost or rotated, delete the encrypted session and
login again. Never send either file to support.

## Resume upload is rejected

- Naukri is the only provider with resume replacement support.
- The file must be inside `CAREER_PORTAL_RESUME_DIRECTORY`.
- Allowed types are PDF, DOC, and DOCX.
- Extension and magic bytes must agree.
- The default limit is 5 MiB.

## Selector drift

Do not loosen selectors to `.first()` or broad CSS matches. Capture sanitized
fixture markup, update the provider-specific workflow, and add a regression
test proving action selectors match exactly one element.
