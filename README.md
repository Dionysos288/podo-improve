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

Create a `.env.local` file:

```env
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
```

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

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
