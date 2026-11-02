# JA FAYD — 2FA rollout and WAF checklist

## Temporary rollout exception

The account `ahmadali.sco12@gmail.com` is temporarily exempt from TOTP checks for superadmin operations to prevent lockout during staging rollout. This is an explicit security downgrade for that account. All existing authorization, CSRF, and peer-superadmin protection checks still apply. Remove this exemption after testing and enrollment; do not keep it indefinitely.

## Self-service authenticator setup

The draft implementation supports per-superadmin QR enrollment without sharing secrets in chat or Render. Each admin opens the superadmin panel, enters their existing password, scans the QR code in an authenticator app, and confirms a valid 6-digit code. Secrets are stored in the existing application database. QR images are generated on the server; no third-party QR website receives the secret.

Once an admin enrolls, the superadmin API requires their current TOTP code, even if the global flag is off. Other admins can continue working until enrolled.

**Do not set JA_BLOOM362_ADMIN_TOTP_REQUIRED=1 until all superadmins have enrolled.** If enabled, unprovisioned admins cannot use superadmin operations, though they can still log in and enroll.

This is step-up protection for superadmin API operations, **not** complete MFA for initial login. Recovery, device replacement, key rotation, and backup codes are not yet implemented. Before production release, implement and test a safe recovery procedure, then test in staging.

## Tests before production

- Admin with correct password can generate a QR and confirm code; wrong password and wrong code fail.
- Enrolled admin cannot access superadmin endpoints without a valid TOTP; non-admin remains forbidden.
- Non-enrolled admins can still enroll while the global flag is off.
- Confirm database schema migration succeeds on PostgreSQL and SQLite; verify dependency install.
- Check CSRF validation, cookie security, Render logs, and expiry of TOTP codes.
- Confirm the QR is never sent to third-party services or logged.
- Test account recovery with the authenticator device unavailable.

## WAF (external DNS provider action required)

A WAF cannot be enabled from this repository. Configure your domain in Cloudflare or another WAF provider, proxy traffic through it, enforce HTTPS with Full (strict) TLS, enable managed rules and bot protection, and rate-limit authentication endpoints. Review Render origin bypass and confirm exact trusted CORS origins. Verify production secure cookies, Supabase backups, and GitHub secret scanning.

**This draft has not been integration-tested or deployed. Do not merge into production without a staging test and an administrator recovery plan.**
