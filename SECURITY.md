# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Graphium, please report it responsibly.

### How to Report

1. **Do NOT open a public issue** for security vulnerabilities
2. Email: **kumagallium@gmail.com**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity, typically within 2 weeks for critical issues

### Scope

The following are in scope:

- Authentication/authorization bypasses (Google OAuth flow)
- Cross-site scripting (XSS) in the editor
- Data leakage (provenance data, Google Drive tokens)
- Injection vulnerabilities

The following are out of scope:

- Issues in third-party dependencies (report upstream)
- Attacks requiring physical access to the user's device
- Social engineering

## Security Considerations

Graphium handles sensitive research data. Key security measures include:

- **Google OAuth 2.0**: Used for authentication and Drive access
- **Client-side storage**: Data is stored in Google Drive, not on our servers
- **No server-side storage**: The hosted version is a static site with no backend
- **Content Security Policy**: Applied to prevent XSS attacks

## Disclosure Policy

We follow a coordinated disclosure process. Please allow us reasonable time to address the issue before public disclosure.
