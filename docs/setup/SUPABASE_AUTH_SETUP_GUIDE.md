# VISHREA STUDIO — Supabase Direct Email OTP Setup Guide

This guide details how to configure Supabase Authentication to send passwordless Email OTPs **directly via Supabase itself**—without needing the Resend API or any external SMTP configuration.

---

## 1. Direct Supabase Email Delivery (No Resend / No Custom SMTP)

Navigate to: **Supabase Dashboard → Authentication → Emails → SMTP Settings**  
*(URL: `https://supabase.com/dashboard/project/djledhngxizbrtgfoclud/auth/smtp`)*

Configure the setting:

| Field | Configuration Value | Reason |
| :--- | :--- | :--- |
| **Enable custom SMTP** | **Toggle OFF (Disabled)** | Disabling custom SMTP tells Supabase to send all authentication and OTP emails directly through Supabase's built-in email service. You do **not** need Resend API keys, SMTP hosts, or external credentials. |

> [!NOTE]
> When **Enable custom SMTP** is toggled **OFF**, Supabase handles email generation, queuing, and delivery internally. No external email service or Resend configuration is required for customer authentication.

Click **Save**.

---

## 2. Branded Email OTP Template

Navigate to: **Authentication → Emails → Templates → Magic Link**  
*(This template is used by Supabase for both Magic Link and passwordless Email OTP)*

### Set the **Subject**:
```
Your Vishrea Studio Sign-In Code: {{ .Token }}
```

### Set the **Body (HTML)**:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your Vishrea Studio Sign-in Code</title>
</head>
<body style="font-family: Georgia, serif; background-color: #faf9f5; margin: 0; padding: 40px 20px; color: #1c1917;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e7e5e4; padding: 40px; margin: auto;">
    <tr>
      <td align="center" style="padding-bottom: 24px;">
        <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.25em; color: #722f37; margin: 0;">Vishrea Studio</p>
        <h1 style="font-size: 26px; font-weight: 400; margin: 12px 0 6px;">Sign-in Verification</h1>
        <p style="font-size: 14px; color: #78716c; margin: 0;">Private wardrobe access</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px 0; border-top: 1px solid #f5f5f4; border-bottom: 1px solid #f5f5f4; text-align: center;">
        <p style="font-size: 14px; color: #44403c; margin: 0 0 16px;">Enter this 6-digit code to sign in to your Vishrea Studio account:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 0.35em; color: #1c1917; background-color: #faf9f5; border: 1px solid #e7e5e4; padding: 16px 24px; display: inline-block; font-family: monospace;">
          {{ .Token }}
        </div>
        <p style="font-size: 12px; color: #a8a29e; margin: 16px 0 0;">This code is valid for 10 minutes and can only be used once.</p>
      </td>
    </tr>
    <tr>
      <td style="padding-top: 24px; font-size: 12px; color: #78716c; line-height: 1.6; text-align: center;">
        If you did not request this sign-in code, you can safely ignore this email.<br>
        © 2026 Vishrea Studio · Hebbagodi, Bengaluru
      </td>
    </tr>
  </table>
</body>
</html>
```

Click **Save**.

---

## 3. Auth Provider Settings

Navigate to: **Authentication → Sign In / Providers → Email**

1. **Enable Email provider**: `ON`
2. **Confirm email**: `ON`
3. **Secure email change**: `ON`
4. **Enable passwordless sign-in (OTP)**: `ON`
5. **Mailer autoconfirm**: `OFF` (Customers must enter the 6-digit code)

Click **Save**.

---

## 4. URL Configuration & Redirect Allowlist

Navigate to: **Authentication → URL Configuration**

1. **Site URL**:
   - Development: `http://localhost:5173`
   - Production: `https://vishreastudio.com`
2. **Redirect URLs (Allowlist)**:
   Add the following entries:
   ```
   http://localhost:5173/**
   http://127.0.0.1:5173/**
   http://localhost:3000/**
   http://127.0.0.1:3000/**
   https://vishreastudio.com/**
   ```

Click **Save**.

---

## 5. Rate Limits & OTP Expiration

Navigate to: **Authentication → Rate Limits**

- **Email OTP Expiration**: `600 seconds` (10 minutes).
- **Max Email OTP verification attempts**: `5` per token.
- **Email rate limit**: Recommended `30 per hour` per IP.

---

## 6. Environment Variables Checklist

Only Supabase credentials are required for authentication:

### Backend (`.env`):
```env
SUPABASE_URL=https://djledhngxizbrtgfoclud.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
ADMIN_ALLOWED_EMAILS=vishreastudio.admin@gmail.com,intellibytevaishal@gmail.com,admin@vishrea.com
DEFAULT_ADMIN_EMAIL=vishreastudio.admin@gmail.com
```

### Frontend (`vishrea-react/.env`):
```env
VITE_SUPABASE_URL=https://djledhngxizbrtgfoclud.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

> [!TIP]
> The Resend API key is **not needed** for Supabase Auth when using Supabase's direct built-in email service.
