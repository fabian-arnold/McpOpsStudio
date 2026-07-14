---
title: Navigation and roles
description: Move between installation-wide and Project-scoped work in MCP Ops Studio.
---

# Navigation and roles

The application shell keeps installation-wide administration and Project work
in one place. The project switcher selects the Project used by every operational
screen. The environment indicator summarizes the environments returned for that
view, while the Development and Production badges show delivery status.

![MCP Ops Studio navigation with the Project and Administration groups](../screenshots/app/navigation.png)

## Sidebar groups

- **Overview** gives owners and admins a cross-project operational summary.
- **Project** contains authoring, endpoint, security, execution, deployment, and
  Project settings pages for the selected Project.
- **Administration** contains Projects, Users, and the immutable Audit log.
- Footer links open the source repository, legal notices, documentation hub, and
  platform capability settings.

## Roles

| Role | Typical work |
| --- | --- |
| Owner | Installation ownership, users, Projects, security, and all Project work |
| Admin | Installation and Project administration, security, and delivery |
| Developer | Functions, Libraries, bindings, endpoints, validation, and testing |
| Operator | Deployments, releases, rollback, endpoint status, and diagnostics |
| Viewer | Read-only operational inspection |

The UI shows actions appropriate to the signed-in role. API authorization
applies the same role checks to every mutation.

## Header controls

The header provides Project delivery status, notifications, theme selection,
and the signed-in user menu. **Undeployed changes** deploys the complete Project
to Development. The Production badge links to release status on Deployments.

On narrow screens, the menu button opens the same navigation as a mobile drawer.

## Related guides

- [Getting started](../getting-started.md)
- [Dashboard](./dashboard.md)
- [Projects](./projects.md)
- [Users](./users.md)
