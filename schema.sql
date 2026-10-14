PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Admin', 'Manager', 'Inspector', 'Student')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    position TEXT NOT NULL DEFAULT 'Canteen staff',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
    food_rating INTEGER NOT NULL CHECK (food_rating BETWEEN 1 AND 5),
    cleanliness_rating INTEGER NOT NULL CHECK (cleanliness_rating BETWEEN 1 AND 5),
    service_rating INTEGER NOT NULL CHECK (service_rating BETWEEN 1 AND 5),
    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Snacks', 'Dinner')),
    comments TEXT NOT NULL DEFAULT '' CHECK (length(comments) <= 200),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_time_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duration_minutes REAL NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 240),
    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Snacks', 'Dinner')),
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN ('Taste', 'Freshness', 'Cleanliness', 'Waiting time', 'Portion size', 'Staff behaviour', 'Other')),
    description TEXT NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Snacks', 'Dinner')),
    priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
    assigned_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved')),
    resolution TEXT NOT NULL DEFAULT '' CHECK (length(resolution) <= 1000),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS food_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_date TEXT NOT NULL,
    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Snacks', 'Dinner')),
    inspector_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    inspector_name TEXT NOT NULL,
    score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
    remarks TEXT NOT NULL DEFAULT '' CHECK (length(remarks) <= 1000),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hygiene_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_date TEXT NOT NULL,
    inspector_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    inspector_name TEXT NOT NULL,
    score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
    remarks TEXT NOT NULL DEFAULT '' CHECK (length(remarks) <= 1000),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inspection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_inspection_id INTEGER REFERENCES food_inspections(id) ON DELETE CASCADE,
    hygiene_inspection_id INTEGER REFERENCES hygiene_inspections(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Pass', 'Needs Improvement', 'Fail', 'Compliant', 'Non-Compliant')),
    remarks TEXT NOT NULL DEFAULT '' CHECK (length(remarks) <= 500),
    CHECK ((food_inspection_id IS NOT NULL) != (hygiene_inspection_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS corrective_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    assigned_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Completed')),
    complaint_id TEXT REFERENCES complaints(id) ON DELETE SET NULL,
    food_inspection_id INTEGER REFERENCES food_inspections(id) ON DELETE SET NULL,
    hygiene_inspection_id INTEGER REFERENCES hygiene_inspections(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS improvement_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    problem TEXT NOT NULL,
    target TEXT NOT NULL,
    corrective_action TEXT NOT NULL DEFAULT '',
    baseline TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    owner_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    due_date TEXT,
    stage TEXT NOT NULL DEFAULT 'Plan' CHECK (stage IN ('Plan', 'Do', 'Check', 'Act', 'Completed')),
    status TEXT NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned', 'In Progress', 'Checking results', 'Completed')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS five_whys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem TEXT NOT NULL,
    whys_json TEXT NOT NULL,
    root_cause TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fishbone_causes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('People', 'Methods', 'Machines', 'Materials', 'Environment')),
    cause TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_date TEXT NOT NULL,
    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Snacks', 'Dinner')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_service_time_created ON service_time_records(created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints(created_at);
CREATE INDEX IF NOT EXISTS idx_food_inspections_date ON food_inspections(inspection_date);
CREATE INDEX IF NOT EXISTS idx_hygiene_inspections_date ON hygiene_inspections(inspection_date);
