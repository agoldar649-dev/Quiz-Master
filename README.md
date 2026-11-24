# QuizMaster

QuizMaster uses a vanilla HTML/CSS/JavaScript frontend, an Express backend, and SQLite via `sql.js`.

## Local setup

Requires Node.js and npm.

1. Copy `.env.example` to `.env` in the project root.
2. Set `ADMIN_PASSWORD` to a unique password of at least 12 characters. Set `SESSION_SECRET` to a random value of at least 32 characters; it may be left blank for local development.
3. In a terminal, run:

   ```powershell
   cd backend
   npm install
   npm start
   ```

4. Open <http://localhost:4000>.

`npm start` serves the existing frontend and API from the same Express server. The initial admin account uses `ADMIN_EMAIL` and `ADMIN_PASSWORD`; these values are only used when that admin account does not already exist. Existing database accounts are not reset.

## Hosting

Set `NODE_ENV=production`, `PORT` (usually provided by the host), and a strong `SESSION_SECRET` of at least 32 characters in the hosting provider's environment settings. HTTPS production cookies are secure, HTTP-only, and same-site lax; local development keeps cookies usable over HTTP.

Attach persistent disk storage to the service and set `DB_PATH` to an absolute path on that disk, for example `/data/quizmaster.sqlite`. To retain the existing data, copy `backend/quizmaster.sqlite` to the mounted disk before first startup and point `DB_PATH` to that copied file. The default database path remains `backend/quizmaster.sqlite`; the app only initializes a new database when that file does not exist and saves updates to the configured path.

Before exposing an imported database, verify privately that its existing admin account has a unique, secure password. `ADMIN_PASSWORD` creates a missing admin account; it does not reset existing accounts.

Run one application instance with exclusive write access to this SQLite file. The database is held in memory by `sql.js` and written back to disk when data changes, so ephemeral storage, multiple writers, or multiple replicas are not suitable. Keep backups of the persistent database volume.
