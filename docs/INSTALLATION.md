# Installation and client configuration

## Prerequisites

- Node.js 22 or later
- npm
- A supported desktop environment for headed Chromium login
- Current legal/provider approval for the intended LinkedIn or Naukri use
- A local directory readable only by the operating-system user

## Build and browser installation

Run from `src/career-portal-mcp`:

```shell
npm install
npm run build
npx playwright install chromium
```

Linux hosts may require:

```shell
npx playwright install --with-deps chromium
```

Do not run browser-account tools on a headless host: initial login and MFA are
deliberately manual and headed.

## Create local state

Use a different key and state directory for each operating-system account.
Never put the key, encrypted session, or resumes in the repository.

### Windows PowerShell

```powershell
$state = "$env:USERPROFILE\.career-portal-mcp"
$resumes = Join-Path $state "resumes"
New-Item -ItemType Directory -Force $state, $resumes | Out-Null
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
[IO.File]::WriteAllText(
  (Join-Path $state "session.key"),
  [Convert]::ToBase64String($bytes),
  (New-Object Text.UTF8Encoding($false))
)
```

Remove inherited ACLs from the state directory and grant only the current user
full control using your organization's approved Windows ACL tooling.

### macOS

```bash
install -d -m 700 "$HOME/.career-portal-mcp/resumes"
openssl rand -base64 32 > "$HOME/.career-portal-mcp/session.key"
chmod 600 "$HOME/.career-portal-mcp/session.key"
```

### Linux

```bash
install -d -m 700 "$HOME/.career-portal-mcp/resumes"
openssl rand -base64 32 > "$HOME/.career-portal-mcp/session.key"
chmod 600 "$HOME/.career-portal-mcp/session.key"
```

## MCP client configuration

Replace every angle-bracket placeholder. Keep mutations `false` until login
and read-only smoke tests pass.

### GitHub Copilot

Add the server from `config/mcp-config.example.json` under `mcpServers` in the
user MCP config. Use absolute native paths. The command must be `node` and the
first argument must be the absolute path to `dist/secure-launcher.js`.

### Claude Desktop

Add this entry under `mcpServers` in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "career-portal": {
      "command": "node",
      "args": ["<ABSOLUTE_PACKAGE_PATH>/dist/secure-launcher.js"],
      "env": {
        "CAREER_PORTAL_SESSION_KEY_FILE": "<ABSOLUTE_STATE_PATH>/session.key",
        "CAREER_PORTAL_SESSION_FILE": "<ABSOLUTE_STATE_PATH>/sessions.enc",
        "CAREER_PORTAL_RESUME_DIRECTORY": "<ABSOLUTE_RESUME_DIRECTORY>",
        "CAREER_PORTAL_LINKEDIN_BROWSER_ENABLED": "true",
        "CAREER_PORTAL_NAUKRI_BROWSER_ENABLED": "true",
        "CAREER_PORTAL_MUTATIONS_ENABLED": "false"
      }
    }
  }
}
```

### VS Code

Add this entry to `.vscode/mcp.json` or the user-level MCP configuration:

```json
{
  "servers": {
    "career-portal": {
      "type": "stdio",
      "command": "node",
      "args": ["<ABSOLUTE_PACKAGE_PATH>/dist/secure-launcher.js"],
      "env": {
        "CAREER_PORTAL_SESSION_KEY_FILE": "<ABSOLUTE_STATE_PATH>/session.key",
        "CAREER_PORTAL_SESSION_FILE": "<ABSOLUTE_STATE_PATH>/sessions.enc",
        "CAREER_PORTAL_RESUME_DIRECTORY": "<ABSOLUTE_RESUME_DIRECTORY>",
        "CAREER_PORTAL_LINKEDIN_BROWSER_ENABLED": "true",
        "CAREER_PORTAL_NAUKRI_BROWSER_ENABLED": "true",
        "CAREER_PORTAL_MUTATIONS_ENABLED": "false"
      }
    }
  }
}
```

Restart the client after editing configuration.

## Login, logout, and expiry

1. Call `start_browser_login` for one provider.
2. Enter credentials and complete MFA only in the headed provider browser.
3. Call `complete_browser_login`.
4. Verify `get_browser_auth_status` returns `authenticated`.
5. Repeat for the other provider.

`logout_browser_session` deletes that provider's encrypted local storage state.
For Naukri, successful manual login is recognized only after the browser reaches
the provider's authenticated `https://www.naukri.com/mnjuser/homepage` route.
It does not revoke provider-side sessions; use the provider's account-security
page for remote revocation. Expired sessions return `AUTH_REQUIRED`; repeat the
manual login flow. CAPTCHA, MFA, or account challenges return
`ANTI_BOT_CHALLENGE` and are never bypassed.

## Upgrade

1. Back up the encrypted session file and key separately.
2. Update source or package version.
3. Run `npm install`, `npm run build`, and `npx playwright install chromium`.
4. Run the validation commands in `TESTING.md`.
5. Restart the MCP client and perform read-only smoke tests.

Do not rotate the key during a routine upgrade. If rotation is required,
logout first, remove the encrypted session file, create a new key, and login
again.

## Uninstall and data removal

1. Remove the `career-portal` MCP client entry.
2. Stop all MCP client processes.
3. Delete the package installation.
4. Delete the local encrypted session, key, and resume directory.
5. Revoke active sessions from LinkedIn and Naukri account-security pages.

Deleting only the package does not remove the local session or provider-side
sessions.
