# Testing/Running Code
- Use Bun for all JS/TS.
- All services runnable from root — root package.json owns the scripts.
- Fix type errors until suite green.

# Code Style
- Do not write a large amount of content to the same file at once. Plan content, write in batches.

# Documentation
- READMEs are source of truth for architecture & state. After any change to a service/app, update its README in the same change.
- Root README (services table, V1 Features, Performance) reflects current repo state.
- New env var → add to .env.example too. New feature/config → update tables + Config section.
- Architecture diagrams in service READMEs must match actual data flow.

# Environment & Config
- Never commit secrets. .env stays gitignored; .env.example is the template.

# Cross-Service Awareness
- Search API reads ES index created by crawler (`ensureIndex`). Changes to index mapping/analyzers in crawler impact search-api queries — update both READMEs.
- Index name shared via ES_INDEX/ES_HOST env across all services.

# Verification
- Run `bun run build:<service>` and `bunx tsc --noEmit` for type green.
