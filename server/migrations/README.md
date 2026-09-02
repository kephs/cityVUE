# Database migrations

Migration files use `YYYYMMDDHHMMSS-kebab-case-description.ts` names. Phase C0 adds Organization and Service Catalog persistence; Phase D0 adds canonical ServiceRequest creation persistence. Create later reviewed migrations with `npm run migration:create -- description-in-kebab-case`.
