# JA FAYD — security deployment checklist

## Admin two-factor authentication (TOTP)

This branch adds an **optional, fail-closed when enabled** second factor to every `/api/superadmin/*` route. The login itself still uses password/session; 2FA protects superadmin operations only. It is **not** full login MFA.

1. For **each** email in `SUPER_ADMIN_LOGINS`, generate a unique random 20-byte base32 secret using a trusted local secret generator. Never commit these secrets.
2. Add each secret as a manual TOTP entry to that administrator's authenticator app. Confirm a valid code on a staging deployment.
3. Set Render secret environment variable `JA_BLOOM362_ADMIN_TOTP_SECRETS` to a JSON object mapping **lowercase emails** to base32 secrets. Include every configured superadmin (including the `JA_BLOOM362_SUPER_ADMIN` override).
4. Only after every administrator has confirmed their authenticator setup, set `JA_BLOOM362_ADMIN_TOTP_REQUIRED=1` and redeploy. The service refuses to start if an administrator has no configured secret. Keep this flag unset until provisioning is complete.
5. Store emergency recovery credentials securely outside the repository. To rotate an admin's TOTP key, replace their secret in Render and reprovision their app. Existing 2FA codes expire after approximately 30 seconds (server allows ±30 seconds).
6. Test: missing/wrong code fails with HTTP 403, valid code succeeds, non-admin accounts cannot access admin APIs, and the ordinary CRM continues to work.

**Limitations:** A TOTP code is prompted for when admin requests are made, with a 20-second in-memory browser reuse window. TOTP is phishable and does not replace hardware security keys. Production rollout requires staging tests.

## WAF and perimeter protection (manual external setup)

A WAF cannot be enabled by repository code alone. The DNS/domain owner must connect the domain to Cloudflare or another WAF provider and configure:

- Proxy the public domain through the WAF, use Full (strict) TLS, and enforce HTTPS.
- Rate-limit `/api/login`, `/api/register`, `/api/form-login`, and `/api/form-register`; challenge suspicious spikes rather than blocking legitimate users.
- Add managed WAF rules, bot protection, and alerts. Avoid blocking API POSTs indiscriminately.
- Prevent bypassing the WAF by direct access to the Render origin where feasible; review how the Render hostname is exposed.
- In Render, verify `JA_BLOOM362_APP_ENV=production` or `APP_ENV=production`, `JA_BLOOM362_COOKIE_SECURE=1`, and allow only exact trusted origins in `JA_BLOOM362_ALLOWED_ORIGINS`.
- Turn on Supabase backups, review database credentials and rotate any exposed credentials. Enable GitHub secret scanning and branch protection.

Do not advertise this as a guarantee against compromise. Run a staging test and review logs before production deployment.
