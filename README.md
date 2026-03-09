# 100Devs Notes

Community notes from 100Devs, collected and shared via git. This repo is **only** for 100Devs notes.

**Repo:** https://github.com/JoshWrites/100devs-notes  
**Live at:** https://levinelabs.co.il/100devs/notes/ (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))

> This setup may be reused as a template for other notes pages (e.g., different projects or communities).

## Contributing

1. **Fork** this repo
2. **Copy** `TEMPLATE.md` to `notes/{your-slug}/YYYY-MM-DD.md` (e.g. `notes/annylevine/2026-03-09.md`)
3. **Fill in** the frontmatter:
   - `lesson`: Lesson number (integer)
   - `tags`: Content tags — use `css`, `js`, `the-hunt` (add others as needed)
   - `author`: Your name
   - `date`: YYYY-MM-DD
4. **Write** your notes in the body
5. **Open a Pull Request**

Labels can be applied when you submit (in the PR) or by the repo manager during review. Once merged to `main`, notes appear on the site within a few minutes.

## Labels / Tags

- `css` — CSS-related content
- `js` — JavaScript-related content  
- `the-hunt` — The Hunt (job search) content

Add new tags in the frontmatter as the curriculum evolves.

## Template

See [TEMPLATE.md](TEMPLATE.md) for the note structure.

## Coda Migration

Notes are migrated from Coda via browser snapshot parsing. See [docs/CODA_MIGRATION.md](docs/CODA_MIGRATION.md) for the automated workflow (Cursor agent + scripts).
