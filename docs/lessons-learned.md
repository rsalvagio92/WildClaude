## 2026-04-13

- **[error-handling]** `process.on('unhandledRejection', ...)` was registered inside `main()` instead of at module level. This means it was not active during module initialization — any unhandled rejections before `main()` body executes (module-level side-effects, early imports) would not be caught. Register global process handlers at module scope, before `main()` is invoked.

- **[testing]** UPLOADS_DIR test assertions used a loose regex `/uploads$/` instead of an exact path. This passes even if the implementation is wrong (e.g., `/tmp/uploads`). Prefer exact equality against the canonical constant: `expect(UPLOADS_DIR).toBe(path.join(USER_DATA_DIR, 'uploads'))`. This also ensures the test stays correct when `USER_DATA_DIR` is overridden via the `WILD_DATA_DIR` env var.

- **[git]** Backup files (`.bak`, `.bak2`) were committed to the initial commit and required a cleanup commit. Add `*.bak`, `*.bak*`, `*.swp` to `.gitignore` before any first commit. A pre-commit hook (`scripts/pre-commit-check.sh` already exists) could enforce this automatically.
