# CampusFix

CampusFix is a full-stack campus support portal built with Node.js and SQLite. It includes student registration, administrator-managed complaint status, a Lost & Found board, CSV export, and administrator-only JSON backups.

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite` module)

## Run locally

From this directory, open PowerShell and run:

```powershell
$env:ADMIN_EMAIL = "admin@your-campus.example"
$env:ADMIN_PASSWORD = "use-a-unique-password-of-at-least-12-characters"
$env:ADMIN_NAME = "Campus Admin"
npm start
```

Open [http://localhost:3000](http://localhost:3000), create a student account, or sign in with the configured administrator credentials. The administrator is created on first startup and is never created from a public registration form. Choose a strong, unique admin password and do not use demo credentials for real data.

The SQLite database is stored in `data/campusfix.sqlite`. Set `PORT`, `HOST`, `CAMPUSFIX_DATA_DIR`, or `CAMPUSFIX_DB_PATH` to customize the local server and database location. Use `npm run dev` for automatic server restarts during development, and `npm test` to run the test suite.

To set or change an administrator login without putting the password in source code or shell history, run this command in an interactive terminal:

```powershell
npm run admin:setup -- sk.rasheedchotu143@gmail.com
```

Enter and confirm a unique administrator password of at least 12 characters when prompted; input is not echoed. This updates the existing administrator account, revokes its active sessions, and stores only a salted password hash. Restart the server after changing credentials.

To have the setup utility generate a random password instead, run `npm run admin:setup -- sk.rasheedchotu143@gmail.com --generate` and save the password it prints.

## Security and deployment

Passwords are stored as salted scrypt hashes. Session tokens are random, stored only as hashes in SQLite, and sent in HttpOnly, SameSite cookies. Only administrators can list other students' complaints, update status, or restore a backup. Student registration always assigns the Student role on the server.

The app is intended to run behind HTTPS in production; set `NODE_ENV=production` so session cookies are marked Secure, configure a strong administrator password, and use a persistent, backed-up database volume. The built-in in-memory sign-in rate limiter is intended for a single server process; use an edge proxy or shared limiter when deploying multiple instances.
