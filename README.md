# Smart Canteen Quality Monitoring System

A responsive college-canteen quality application built with Flask, SQLite, HTML, CSS, JavaScript, Chart.js, and Lucide icons. The manager dashboard and student interface use the same server and database. Records submitted by a student are visible in manager reports and dashboard data after refresh (the manager dashboard polls every 15 seconds).

## Folder structure

```text
smart-canteen-tqm/
├── app.py                  # Flask routes, validation, role checks, reports
├── database.py             # SQLite connections and opt-in demo seed
├── create_admin.py         # Secure first-admin bootstrap for empty databases
├── schema.sql              # Tables, constraints, and indexes
├── requirements.txt
├── index.html              # Manager and mobile student UI
├── templates/
│   └── login.html
├── assets/
│   ├── css/styles.css
│   └── js/app.js
└── tests/
    └── test_app.py
```

## Install and run (Windows / VS Code)

Open the project folder in VS Code. In PowerShell, run:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Open **http://127.0.0.1:5000/login**. Keep the server running while using the application. The SQLite database is created automatically at `instance/canteen.sqlite3` on first startup.

## Hosting and login troubleshooting

Pushing this repository to GitHub stores the source code; it does not start the Flask server. **GitHub Pages cannot run this app's Python backend**, so API calls for `/api/auth/login`, `/api/auth/logout`, feedback, and other database operations fail there. The frontend and API use same-origin routes, so serving only `index.html` as a static website is not sufficient.

To use the working login/logout and persistent features, run `python app.py` locally, or deploy the complete Flask project to a Python-capable web host. Configure the host to run `gunicorn app:app` (add `gunicorn` to `requirements.txt` if the selected host requires it), set a strong `CANTEEN_SECRET_KEY`, set `CANTEEN_HTTPS=1` behind HTTPS, and configure persistent storage for the SQLite database. Do not use an ephemeral filesystem for the database: it can be erased on restart/redeploy. Use the same deployed Flask origin for the pages and `/api` requests.

For a non-demo deployment, set `CANTEEN_SEED_DEMO=0` and provision the first administrator as described below. Do not publish or use the local demo passwords on a public server.

The first run seeds sample records and the local demo accounts below. Passwords are stored as Werkzeug password hashes, not plaintext:

| Role | Username | Demo password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Manager | `manager` | `manager123` |
| Inspector | `inspector` | `inspector123` |
| Student | `student` | `student123` |

These are public demo credentials for local development only. Do not deploy them. For any shared or production environment, replace the accounts and set a long random `CANTEEN_SECRET_KEY`; use HTTPS and set `CANTEEN_HTTPS=1`.

### Open each interface

- Sign in as Manager/Admin/Inspector for the manager dashboard.
- Sign in as Student for the student-only interface.
- A manager can use the **Student app** control to preview the student layout. The backend still enforces roles; student submissions require a Student account.
- Students can open `/student` after sign-in. **Admin dashboard** is not shown for Student accounts.

## Implemented features

- **Authentication and roles:** Admin, Manager, Inspector, Student; password hashes, session cookies, permission checks, sign-in/out, and Admin-only account creation API.
- **Dashboard:** metrics and Chart.js charts use SQLite aggregates for feedback, complaints, inspection results, satisfaction trend, and measured service time. Authorized staff can record serving durations; the average remains blank until a measurement is recorded.
- **Student app:** current menu, food/hygiene indicators, satisfaction, feedback, complaints, complaint tracking, and personal activity history.
- **Feedback:** separate overall/food/cleanliness/service ratings, meal, comments, range validation, and database history.
- **Complaints:** unique IDs, student ownership checks, status, priority, staff assignment, resolution, filters, and manager status updates.
- **Inspections:** required item validation, server-calculated scores, records/history endpoints, and automatic corrective-action tasks for failed checks.
- **TQM:** Pareto data, fishbone causes, 5 Whys records, defect check sheets, PDCA plans, and a control-chart API. Control limits are returned only after at least 20 observations and use mean ± 3 population standard deviations, bounded to the metric scale.
- **Staff and tasks:** register staff, assign corrective actions and deadlines, and update task status.
- **Reports:** date-range CSV, Excel (`.xlsx`), and PDF exports for feedback, food inspections, hygiene, complaints, satisfaction, and PDCA plans.
- **Demo and live records:** seeded records carry an `is_demo` marker. New submissions are saved separately as live records. Service-time records are entered measurements, not seeded estimates.

## Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The tests use a temporary SQLite database and cover feedback persistence, server-side inspection scoring and corrective actions, complaint ID/ownership/status, measured service-time validation/aggregation, report generation, invalid input, and role permissions.

## Configuration

Environment variables:

- `CANTEEN_DATABASE` — optional SQLite file path. Defaults to `instance/canteen.sqlite3`.
- `CANTEEN_SECRET_KEY` — Flask session-signing secret. Set this to a secure random value outside local demos.
- `CANTEEN_HTTPS=1` — mark the session cookie Secure when serving through HTTPS.
- `CANTEEN_SEED_DEMO=0` — skip demo seeding when creating a fresh non-demo database. Create its first Admin with `python create_admin.py` before starting Flask, keeping this setting at `0`.
- `HOST` / `PORT` — development server bind address and port.

For a fresh database without demo accounts, set `CANTEEN_SEED_DEMO=0`, run `python create_admin.py`, and then run `python app.py` in the same PowerShell session. The bootstrap command prompts for a password without echoing it, requires at least 12 characters, hashes it, and refuses to run if any user already exists. Keep `CANTEEN_SEED_DEMO=0` set while running the app so demo accounts are not added on startup.

The dashboard loads Lucide, Chart.js, and Google Fonts from CDNs, so those visual assets require internet access. Flask and report dependencies are installed locally from `requirements.txt`.

## API overview

All writes are validated server-side and use parameterized SQLite statements.

| Area | Routes |
|---|---|
| Authentication | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/users`; CLI first-admin bootstrap: `python create_admin.py` |
| Dashboard | `GET /api/dashboard`, `POST /api/service-times` |
| Feedback | `GET/POST /api/feedback`, `GET /api/feedback/mine` |
| Complaints | `GET/POST /api/complaints`, `GET /api/complaints/mine`, `GET/PATCH /api/complaints/<id>` |
| Inspections | `POST /api/inspections/food`, `POST /api/inspections/hygiene`, `GET /api/inspections/<food-or-hygiene>` |
| TQM / PDCA | `GET /api/tqm`, `GET /api/tqm/control-chart`, `POST /api/analysis/fishbone`, `POST /api/analysis/five-whys`, `POST/PATCH /api/improvements` |
| Staff / tasks | `GET/POST /api/staff`, `GET/POST /api/corrective-actions`, `PATCH /api/corrective-actions/<id>` |
| Reports / menu | `GET /api/reports/<type>?start=YYYY-MM-DD&end=YYYY-MM-DD&format=pdf|xlsx|csv`, `GET /api/menu` |

## Scope notes

- SQLite is the implemented database. MySQL is not supported yet; adding it safely requires an adapter and migration for the SQLite-specific queries and schema.
- Service-time average is calculated from staff-entered durations. It is blank until the first measurement; enter elapsed minutes from service start to serving completion.
- Menu day tabs are visual controls; the implemented menu endpoint returns the current day's published items.
- Account registration is available to Admin through the API. The seeded demo accounts are intended for local evaluation.
