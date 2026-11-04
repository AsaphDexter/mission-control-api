# Mission Control API

**Mission Control API** is the backend REST API powering Mission Control, a QA Engineering Learning and Practice Platform under the Mission Control with Mike initiative.

The platform aims to bridge the gap between theoretical software testing knowledge and practical QA engineering skills through learning resources, practical challenges, submissions, evaluation and learning progress tracking.

## Project Status

**Early development: API foundation established.**

### Implemented capabilities

- Fastify HTTP application.
- TypeScript with strict compiler settings.
- Runtime response schemas using TypeBox.
- Health and readiness endpoints.
- Automated HTTP route tests using Vitest.
- ESLint and Prettier quality tooling.

PostgreSQL, Prisma, authentication and the learning platform modules are planned for subsequent development phases.

## Technology Stack

- Node.js
- TypeScript
- Fastify
- TypeBox
- Vitest
- ESLint
- Prettier

## Requirements

- Node.js >= 22.19.0
- npm

## Getting Started

Clone the repository and install dependencies using `npm ci`.

Start the development server using `npm run dev`.

By default, the application listens on:

`http://127.0.0.1:3000`

## Available Endpoints

| Method | Endpoint  | Purpose               |
| ------ | --------- | --------------------- |
| GET    | `/health` | Application health    |
| GET    | `/ready`  | Application readiness |

The readiness endpoint currently checks application availability only. Database connectivity checks will be introduced with PostgreSQL integration.

## Development Commands

| Command             | Purpose                    |
| ------------------- | -------------------------- |
| `npm run dev`       | Start development server   |
| `npm run build`     | Compile TypeScript         |
| `npm start`         | Start compiled application |
| `npm run typecheck` | Run TypeScript checks      |
| `npm test`          | Run automated tests        |
| `npm run lint`      | Run ESLint                 |
| `npm run format`    | Format project files       |

## Architecture Direction

Mission Control API follows a modular monolith architecture.

Planned functional modules include:

- Authentication and user management.
- Roles and permissions.
- Learning resources and categories.
- Practical QA challenges.
- Submissions and evaluation.
- Learning progress.
- Administration and audit logging.

## Security Principles

- Never commit credentials, tokens or private environment files.
- Keep secrets outside source control.
- Validate incoming API requests.
- Apply authentication and authorisation controls to protected operations.
- Maintain dependency security audits.
- Protect user information and submission data.

## Branching Strategy

- `main`: Stable release branch.
- `develop`: Active development branch.
- Feature branches: Isolated development work.

## Licence

MIT License. See [LICENSE](LICENSE).
