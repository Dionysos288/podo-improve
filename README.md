# Podo Improve

Open source platform for foot health assessment, custom insole optimization, and patient management.

## Overview

Podo Improve helps podiatrists, clinics, and foot care specialists streamline their workflow by providing digital tools for:

- Patient management
- Foot assessment tracking
- Insole recommendations
- Treatment progress monitoring
- Reporting and documentation
- Data-driven insights

Our mission is to make modern foot care technology accessible to everyone through open source software.

## Features

### Patient Management
- Create and manage patient profiles
- Store assessment history
- Track treatment progress over time

### Foot Health Assessments
- Record foot measurements and observations
- Monitor changes between visits
- Generate structured reports

### Insole Optimization
- Manage custom insole configurations
- Track modifications and improvements
- Store recommendations and outcomes

### AI-Powered Tools (Upcoming)
- Automated assessment summaries
- Personalized improvement recommendations
- Intelligent documentation assistance
- Clinical insights and analytics

## Tech Stack

- Next.js
- TypeScript
- PostgreSQL
- Supabase
- OpenAI API
- Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 20+
- npm, pnpm, or yarn
- PostgreSQL database

### Installation

```bash
git clone https://github.com/Dionysos288/podo-improve.git

cd podo-improve

npm install
```

Copy [`.env.example`](./.env.example) to `.env.local` and fill in your values (same variable names as production).

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Deploy on Vercel

1. Import the GitHub repo in [Vercel](https://vercel.com/new).
2. Set **Root Directory** to the repo root and keep the default **Next.js** framework preset.
3. Add the variables from [`.env.example`](./.env.example) under **Settings → Environment Variables**. `DATABASE_URL` / `DIRECT_URL` are for Postgres (Prisma); `SUPABASE_SERVICE_ROLE_KEY` is for file uploads. `NEXT_PUBLIC_SUPABASE_URL` can be omitted when `DATABASE_URL` is a Supabase Postgres URL (the app derives `https://<project-ref>.supabase.co` from it).
4. Use the same `DATABASE_URL` / `DIRECT_URL` values as your hosted Postgres (e.g. Supabase connection strings).
5. Set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL (preview and production can each have their own values).
6. Deploy. The build runs `prisma generate` then `next build`; `postinstall` also generates the Prisma client after `npm install`.

If a deployment fails, open the build logs in Vercel and confirm required env vars are set for **Preview** and/or **Production**.

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Open a Pull Request

Please open an issue before implementing major changes.

## Roadmap

- [ ] Patient dashboard
- [ ] Assessment management
- [ ] Insole recommendation engine
- [ ] AI-powered clinical assistant
- [ ] Report generation
- [ ] Multi-clinic support
- [ ] Mobile application

## Vision

We believe healthcare software should be accessible, transparent, and collaborative. Podo Improve aims to become the leading open source platform for digital foot care and custom insole management.

## License

MIT License
