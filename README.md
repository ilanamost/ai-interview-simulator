# AI Project Infrastructure

Reusable scaffolding for AI-assisted projects: rules, docs, and planning conventions that agents (and humans) follow, wired together from [AGENTS.md](AGENTS.md).

## Layout

| Folder | Purpose |
|---|---|
| [.rule/](.rule/) | Required conventions agents must follow — coding, naming, security, testing, error handling, versioning, UI/style |
| [.doc/](.doc/) | Living reference docs — architecture, glossary, product definition |
| [.plan/](.plan/) | Backlog and task planning |

## .rule

| File | Covers |
|---|---|
| [coding-rules.md](.rule/coding-rules.md) | JS/TS coding conventions |
| [naming-rules.md](.rule/naming-rules.md) | Naming conventions |
| [database-rules.md](.rule/database-rules.md) | Schema, migrations, bootstrap |
| [error-handling-rules.md](.rule/error-handling-rules.md) | Error shapes, logging, status codes |
| [security-rules.md](.rule/security-rules.md) | Secrets, auth, input validation, dependencies |
| [testing-rules.md](.rule/testing-rules.md) | Test coverage and design expectations |
| [planning-rules.md](.rule/planning-rules.md) | Planning approach before implementation |
| [versioning-rules.md](.rule/versioning-rules.md) | Versioning and release conventions |
| [ui-rules.md](.rule/ui-rules.md) | UI-specific guidance |
| [style-rules.md](.rule/style-rules.md) | CSS and styling conventions |

Rule files may cross-reference each other using `[[name]]` links.

## .doc

| File | Covers |
|---|---|
| [architecture.md](.doc/architecture.md) | Service boundaries, ownership, data flow, auth/org boundaries |
| [deployment.md](.doc/deployment.md) | Environments, `.env` files per environment, GitHub Pages, self-hosting `api/` |
| [glossary.md](.doc/glossary.md) | Canonical domain terms used across code, API, docs, and plans |
| [product-definition.md](.doc/product-definition.md) | Product vision, target users, scope, success metrics |

## .plan

| File | Covers |
|---|---|
| [000-backlog.md](.plan/000-backlog.md) | Prioritized backlog of current and completed tasks |

## How it fits together

[AGENTS.md](AGENTS.md) is the entry point: it tells agents which `.rule` file governs each area of work, and where to find `.doc` references and `.plan` backlog state. Update the relevant file when its underlying convention or reference changes — see each file's own update triggers.
