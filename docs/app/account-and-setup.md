---
title: Installation and account
description: Complete one-time setup, sign in, and manage a local password.
---

# Installation and account

The one-time setup screen creates the installation owner and first Project. Use
the setup code printed by the configuration container, choose a starter, and
provide the owner email and a strong local password.

The **Clean Project** starter creates Development and Production environments.
The **Note App demo** additionally supplies a working Function, persistence,
MCP and HTTP bindings, and demo authentication for guided exploration.

## Sign in

Open the public control-plane URL and enter the local account email and password.
The signed session carries the installation role and selected Project. Platform
mutations include the CSRF token supplied by the application.

## Change a password

Temporary-password users are directed to **Change password**. Enter the current
password and a new password of at least 12 characters. The application signs the
user out so the next session starts with the new credential.

## Related guides

- [Installation](../installation.md)
- [Users](./users.md)
- [Getting started](../getting-started.md)
