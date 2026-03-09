# 100Devs Notes Deployment

Notes deploy automatically when PRs are merged to `main`. This repo is only for 100Devs; the approach can be reused for other projects. Build runs in GitHub Actions (~1–2 min), then deploys to your server.

## Prerequisites

1. **Create the repo** on GitHub (e.g. `JoshWrites/100devs-notes`).
2. **Add GitHub Secrets** (Settings → Secrets and variables → Actions):

   | Secret | Description |
   |--------|-------------|
   | `NOTES_DEPLOY_KEY` | SSH private key for deploy user |
   | `NOTES_DEPLOY_HOST` | Server host (e.g. `10.100.102.50` or your Proxmox host) |
   | `NOTES_DEPLOY_USER` | SSH user (e.g. `root`) |
   | `NOTES_DEPLOY_PATH` | Target path: `/var/www/html/100devs/notes/` |

3. **Server setup** — create the deploy path and ensure the web server serves it:

   ```bash
   # On Proxmox host or in the website container
   mkdir -p /var/www/html/100devs/notes
   chown -R lighttpd:lighttpd /var/www/html/100devs  # or www-data, depending on your setup
   ```

4. **lighttpd** — notes live at `/100devs/notes/` on the same container as the main site. No extra config needed if your web root is `/var/www/html/` and the deploy path is `/var/www/html/100devs/notes/`.

## Verify

After a merge, check: https://levinelabs.co.il/100devs/notes/
