# Security Policy

## Supported versions

Only the latest published version of each `@eiei114/sub-*` package receives
security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability
reporting:

1. Open the [Security tab](https://github.com/eiei114/pi-sub/security) of this repository.
2. Select **Report a vulnerability**
   ([direct link](https://github.com/eiei114/pi-sub/security/advisories/new)).

This is the only official private reporting channel. Please do not open a public
issue, pull request or discussion for a suspected vulnerability.

Please include:

- Affected version and package name (for example `@eiei114/sub-bar`)
- Impact
- Reproduction steps
- Suggested fix, if known

## Pi package security note

Pi packages can execute code with local user permissions. Review installed
packages and avoid running untrusted extensions.

## About this fork

This repository is an unofficial continuation fork of
[`marckrenn/pi-sub`](https://github.com/marckrenn/pi-sub) that publishes under
the `@eiei114` npm scope. Upstream security issues should also be reported
upstream where they originate there.
