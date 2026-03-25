# Improver UX (web)

Static site: open `index.html` or host on **GitHub Pages**. Keep **`Avapore.otf`** in the same folder as `styles.css` (headline font).

**Features:** **£ GBP** formatting, tabbed layout (**Money** / **Debts** / **Payoff**), income vs **must-pay bills**, bill line-items, **month snapshots**, debt **priority** (people → overdraft → other), chart vs pure avalanche.

## GitHub Pages

1. Push this repo to GitHub.
2. Repo **Settings → Pages**.
3. **Build and deployment**: Source = **Deploy from a branch** (or use **GitHub Actions** if you prefer).
4. Choose branch **main** (or your default) and folder:
   - **`/web`**: site URL will be `https://YOUR_USER.github.io/REPO_NAME/web/`
   - Or move everything inside `web/` into a **`docs`** folder at the repo root and select **`/docs`**: URL will be `https://YOUR_USER.github.io/REPO_NAME/`

5. Wait a minute, then open the URL. Use **HTTPS** so Web Crypto (password hashing) works in all browsers.

## Local preview

From the `web` folder, run a static server (opening the file as `file://` may block crypto in some browsers):

```bash
npx --yes serve .
```

Then visit the URL it prints (e.g. `http://localhost:3000`).

## Backup checker (optional)

From the `web` folder, validate an exported `.json` backup:

```bash
python scripts/validate_improver_backup.py path/to/improver-ux-backup-YYYY-MM-DD.json
```

## Notes

- Data stays in **this browser** (`localStorage`). Clearing site data removes accounts and plans.
- **Add to Home Screen** (Safari / Chrome) uses `manifest.json` for an app-like icon/title where supported.

## Rights

**Copyright © 2026 UX UI MATE. All rights reserved.**

**Private.** The source code, user interface, visuals, copy, product vision, and any other materials in this project (including but not limited to HTML, CSS, JavaScript, assets, and documentation) are **not** licensed for public use, reproduction, or distribution unless **UX UI MATE** explicitly grants permission in writing.
