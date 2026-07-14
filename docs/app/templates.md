---
title: Operational templates
description: Install complete, preconfigured operational units from the server catalog.
---

# Operational templates

Templates package a proven Function, schemas, policy, Secret grants, network
hosts, capabilities, bindings, and setup guidance into one installable unit.

## Explore the catalog

Open `/templates` to browse templates returned by the control plane. Each card
shows availability and the operational capability it adds. The detail view lists
setup steps, permissions, Secrets, network hosts, capabilities, and runtime
characteristics.

## Install a template

1. Select a template and review its documentation.
2. Enter the requested configuration and Secret references.
3. Review the Function policy, network hosts, capabilities, and enabled state.
4. Submit the installation for server-side validation.
5. Open the created Function and endpoint bindings, then deploy the Project.

Installed assets enter Project development state and follow the same save,
validation, deployment, execution, and audit lifecycle as manually created
assets.

## Related guides

- [Functions](./functions.md)
- [Secrets](./secrets.md)
- [Deployments](./deployments.md)
