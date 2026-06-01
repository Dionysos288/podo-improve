# Podo Improve

**Open-source software for podiatry clinics — patient records, 3D custom insole design, and print-ready workflows.**

Podo Improve is a self-hostable web application built for foot care professionals who want modern tooling without vendor lock-in. Fork it, deploy it on your own infrastructure, and adapt it to your practice.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)](https://nextjs.org/)

---

## Why open source?

Healthcare and clinical tooling should be **transparent**, **auditable**, and **under your control**. Podo Improve is released under the [MIT License](./LICENSE) so clinics, developers, and researchers can:

- Run the stack on-premises or in a cloud you trust
- Inspect how patient and design data is handled
- Extend workflows (integrations, locales, compliance) without waiting on a vendor
- Contribute improvements back to the community

> **Note:** Podo Improve is software tooling, not a medical device. You are responsible for clinical decisions, regulatory compliance (e.g. MDR where applicable), and secure handling of health data in your jurisdiction.

---

## Features

| Area | What you get |
|------|----------------|
| **Organizations** | Multi-tenant clinics with slug-based URLs, user roles, and org settings |
| **Patients** | Profiles, history, and per-patient project workflows |
| **3D insole design** | In-browser editor: foot scan alignment, zone heights, landmarks, materials, box cuts, STL export |
| **Projects** | Design sessions linked to patients with persisted parameters |
| **Auth** | [Better Auth](https://www.better-auth.com/) — email/password plus Google and Microsoft OAuth |
| **Storage** | File uploads via Supabase Storage (scans, exports, assets) |
| **3D printing** | Optional Raise3D / ideaMaker integration for slicing workflows |
| **Compliance helpers** | Org settings for backup, MDR-related configuration, and usage limits |

---

## Tech stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router), React 19, TypeScript
- **Database:** PostgreSQL via [Prisma](https://www.prisma.io/)
- **Auth:** Better Auth
- **Files:** Supabase Storage
- **3D:** Three.js, React Three Fiber, mesh BVH / CSG utilities
- **UI:** Tailwind CSS 4, Base UI
- **Email:** Resend (transactional mail)
- **Tests:** Vitest

---

## Quick start

### Prerequisites

- **Node.js 20+**
- **PostgreSQL** (local, Supabase, Neon, or any compatible host)
- Optional: Supabase project (Storage + Postgres), OAuth apps, Resend API key

### 1. Clone and install

```bash
git clone https://github.com/Dionysos288/podo-improve.git
cd podo-improve
npm install
```

### 2. Configure environment

Copy the example env file and fill in values:

```bash
cp .env.example .env.local
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection (pooled) |
| `DIRECT_URL` | Yes | Direct Postgres URL (migrations; use port `5432` on Supabase) |
| `BETTER_AUTH_SECRET` | Yes | Session signing secret |
| `BETTER_AUTH_URL` | Yes | App URL (e.g. `http://localhost:3000`) |
| `NEXT_PUBLIC_APP_URL` | Yes | Public app URL (same as above in dev) |
| `SUPABASE_SERVICE_ROLE_KEY` | For uploads | Supabase Storage access |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Omit if `DATABASE_URL` is Supabase-hosted (derived automatically) |
| `GOOGLE_*` / `MICROSOFT_*` | Optional | Social login |
| `RESEND_*` | Optional | Invitation / transactional email |
| `RAISECLOUD_*` / `IDEAMAKER_PATH` | Optional | 3D printer integration |

### 3. Database

Apply schema and (optionally) seed demo data:

```bash
npm run db:migrate
# optional
npm run db:seed
```

For rapid local prototyping only:

```bash
npm run db:push
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), register or sign in, and create or join an organization.

### Useful scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build (Prisma generate + Next.js) |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (CI mode) |
| `npm run db:studio` | Prisma Studio GUI |

---

## Deploy on Vercel

1. Import the repository in [Vercel](https://vercel.com/new) (root directory = repo root, **Next.js** preset).
2. Add all required variables from [`.env.example`](./.env.example) for **Preview** and **Production** (branch deploys use Preview).
3. Set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to your deployment URL per environment.
4. Use the same `DATABASE_URL` / `DIRECT_URL` as your hosted Postgres.

The build runs `prisma generate` then `next build`. `postinstall` also generates the Prisma client.

**Build failed?** Scroll above `npm run build exited with 1` for the first error. Common fixes: set `DIRECT_URL` to the direct Supabase URL (port `5432`), ensure env vars exist on Preview, and confirm Prisma binary targets match your host (this repo includes `rhel-openssl-3.0.x` for Vercel).

---

## Project structure

```text
src/
  app/              # Next.js routes (auth, org dashboard, design, settings)
  features/         # Domain modules (design, patients, …)
  shared/           # Auth, UI primitives, utilities
  prisma/           # Schema and migrations
public/             # Static assets
```

Deeper 3D editor requirements and zone definitions live in [`3d-modal-requirements.md`](./3d-modal-requirements.md).

---

## Contributing

We welcome bug reports, documentation improvements, and pull requests.

1. **Fork** the repository and create a branch from `main`
2. **Discuss** large changes in an issue first (architecture, schema, auth, or compliance-related work)
3. **Keep PRs focused** — one concern per pull request when possible
4. **Run checks** before opening a PR:

   ```bash
   npm run lint
   npm run test
   npm run build
   ```

5. **Open a pull request** with a clear description and screenshots for UI changes

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

## Roadmap

Community-driven priorities (not exhaustive):

- [ ] Richer patient dashboards and reporting
- [ ] Assessment templates and longitudinal comparison
- [ ] Smarter insole recommendation helpers
- [ ] Broader printer / slicer integrations
- [ ] Improved accessibility and mobile layouts
- [ ] Additional locales

See [Issues](https://github.com/Dionysos288/podo-improve/issues) for active discussion.

---

## Security

If you discover a security vulnerability, please **do not** open a public issue with exploit details. Contact the maintainers privately so we can coordinate a fix.

For production deployments: use strong secrets, HTTPS, database backups, and access controls appropriate for health-related data in your region.

---

## License

Copyright © contributors

Released under the [MIT License](./LICENSE).
