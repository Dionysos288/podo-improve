# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-01

### Added

- Initial public release under the MIT License
- Multi-organization clinic workspaces with role-based access
- Patient records and per-patient design projects
- Browser-based 3D insole editor (scan alignment, zone adjustments, landmarks, materials, STL export)
- Better Auth integration (email/password, Google, Microsoft)
- PostgreSQL data layer with Prisma migrations
- Supabase Storage for scans and design assets
- Organization settings (users, backup, MDR configuration, 3D printer hooks)
- Optional Raise3D / ideaMaker printing integration
- Vercel deployment documentation and production build pipeline

### Notes

- Self-host or deploy to your own infrastructure; configure secrets via `.env.example`
- Software tooling only — not a certified medical device; ensure compliance for your region

[1.0.0]: https://github.com/Dionysos288/podo-improve/releases/tag/v1.0.0
