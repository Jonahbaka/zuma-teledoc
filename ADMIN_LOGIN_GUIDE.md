# Admin Portal Login Guide

## Overview

The DoctaRx admin portal provides secure access to platform management, user administration, financial tools, and system analytics. This guide covers authentication, credential management, and security best practices.

## Initial Super Admin Setup

### Creating the First Super Admin

To create the initial super admin account, run the setup script:

```bash
node server/scripts/setup-super-admin.js
```

The script will prompt you for:
- **Email**: Admin email address
- **First Name**: Admin's first name
- **Last Name**: Admin's last name
- **Password**: Minimum 8 characters (must meet security requirements)

### Default Credentials

**⚠️ IMPORTANT**: There are no default credentials. The super admin account must be created using the setup script above. This ensures security from the start.

If you need to reset a super admin password, you can:
1. Run the setup script again with the same email (it will prompt to update)
2. Use the password reset flow (if email is configured)
3. Manually update the password hash in the database (for emergency access)

## Admin Portal Login

### Access URL

Navigate to: `http://localhost:3000/login` (or your production URL)

### Login Process

1. **Enter Credentials**
   - Email address
   - Password

2. **MFA (if enabled)**
   - If MFA is enabled on your account, you'll be prompted for a 6-digit code
   - Enter the code from your authenticator app (Google Authenticator, Authy, etc.)

3. **Session Management**
   - Access tokens expire after 15 minutes
   - Refresh tokens expire after 7 days
   - You'll be automatically logged out if your session expires

### Role-Based Access

- **Super Admin**: Full access to all features including admin management
- **Admin**: Access to user management, analytics, financial tools, and audit logs

## Credential Management

### Changing Your Password

1. Navigate to **Settings** → **Account** tab
2. Scroll to **Change Password** section
3. Enter:
   - Current password
   - New password (must meet requirements)
   - Confirm new password
4. Click **Change Password**

**Password Requirements:**
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character
- Recommended: 12+ characters for stronger security

**Security Features:**
- All existing sessions are revoked after password change
- You'll be required to log in again
- Password change is logged in audit trail

### Two-Factor Authentication (MFA)

#### Enabling MFA

1. Navigate to **Settings** → **Security** tab
2. Click **Enable 2FA**
3. Enter your password
4. Scan the QR code with your authenticator app
5. Enter the 6-digit verification code
6. **Save your backup codes** in a secure location

#### Disabling MFA

1. Navigate to **Settings** → **Security** tab
2. Click **Disable 2FA**
3. Enter your password and current MFA code
4. Confirm the action

**Important Notes:**
- Backup codes can only be viewed once during setup
- Store backup codes securely (password manager, encrypted file)
- If you lose access to your authenticator app, use backup codes to regain access

## Security Best Practices

### Password Security

1. **Use Strong Passwords**
   - Minimum 12 characters recommended
   - Unique password (not reused elsewhere)
   - Consider using a password manager

2. **Regular Updates**
   - Change password every 90 days
   - Change immediately if compromised

3. **Never Share Credentials**
   - Each admin should have their own account
   - Use the admin management system to create accounts

### MFA Recommendations

1. **Enable MFA Immediately**
   - Required for all admin accounts
   - Use a reputable authenticator app
   - Keep backup codes secure

2. **Device Security**
   - Use a dedicated device for MFA if possible
   - Enable device lock screen
   - Keep authenticator app updated

### Session Security

1. **Logout When Done**
   - Always log out when finished
   - Don't leave sessions open on shared computers

2. **Monitor Activity**
   - Review audit logs regularly
   - Check for suspicious login attempts
   - Report any unauthorized access immediately

## Account Activity Monitoring

### Viewing Audit Logs

1. Navigate to **Audit Logs** in the admin portal
2. Filter by:
   - User ID (your admin ID)
   - Action type (login, change_password, enable_mfa, etc.)
   - Date range
   - PHI access only

### What's Logged

All authentication-related actions are logged:
- Login attempts (successful and failed)
- Password changes
- MFA setup/enable/disable
- Logout events
- Session refreshes

Each log entry includes:
- Timestamp
- IP address
- User agent (browser/device)
- Action description
- Success/failure status
- Error messages (if applicable)

## Troubleshooting

### Can't Log In

1. **Check Credentials**
   - Verify email and password
   - Check for typos
   - Ensure Caps Lock is off

2. **MFA Issues**
   - Verify time sync on your device
   - Try a backup code if available
   - Contact system administrator

3. **Account Locked**
   - Too many failed login attempts may lock the account
   - Contact system administrator to unlock

### Password Reset

If you've forgotten your password:

1. Click **Forgot password?** on the login page
2. Enter your email address
3. Check your email for reset link
4. Follow the instructions to set a new password

**Note**: Password reset requires email verification to be configured.

### MFA Recovery

If you've lost access to your authenticator app:

1. Use one of your backup codes to log in
2. Navigate to Settings → Security
3. Disable MFA
4. Re-enable MFA with a new device

**If you've lost backup codes**: Contact system administrator for account recovery.

## Support

For additional support or security concerns:
- Review audit logs for account activity
- Contact system administrator
- Report security incidents immediately

## Security Reminders

- ✅ Use strong, unique passwords
- ✅ Enable MFA on all admin accounts
- ✅ Review audit logs regularly
- ✅ Log out when finished
- ✅ Never share credentials
- ✅ Keep backup codes secure
- ✅ Report suspicious activity immediately

---

**Last Updated**: 2024
**Version**: 1.0

