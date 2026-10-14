"""SQLite setup and demo data for the Smart Canteen application."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from werkzeug.security import generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("CANTEEN_DATABASE", BASE_DIR / "instance" / "canteen.sqlite3"))


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """Yield a row-aware SQLite connection and always close it."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(seed: bool = True) -> None:
    """Create tables and insert clearly marked demo records once."""
    with get_db() as connection:
        connection.executescript((BASE_DIR / "schema.sql").read_text(encoding="utf-8"))
        if seed:
            seed_demo_data(connection)


def seed_demo_data(connection: sqlite3.Connection) -> None:
    """Insert demo users and realistic sample records into an empty database."""
    if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        return

    users = [
        ("admin", "Admin Demo", "Admin", "admin123"),
        ("manager", "Alex Morgan", "Manager", "manager123"),
        ("inspector", "Jordan Taylor", "Inspector", "inspector123"),
        ("student", "Demo Student", "Student", "student123"),
    ]
    connection.executemany(
        "INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)",
        [(username, name, role, generate_password_hash(password)) for username, name, role, password in users],
    )
    manager_id = connection.execute("SELECT id FROM users WHERE username = 'manager'").fetchone()["id"]
    inspector_id = connection.execute("SELECT id FROM users WHERE username = 'inspector'").fetchone()["id"]
    student_id = connection.execute("SELECT id FROM users WHERE username = 'student'").fetchone()["id"]
    connection.executemany(
        "INSERT INTO staff (name, position, user_id) VALUES (?, ?, ?)",
        [("Jordan Taylor", "Kitchen Inspector", inspector_id), ("Sam Rivera", "Canteen Staff", None), ("Alex Morgan", "Canteen Manager", manager_id)],
    )
    seed_feedback = [
        (5, 5, 5, 4, "Lunch", "Fresh meals and a much faster lunch queue this week.", student_id, 1),
        (4, 4, 5, 4, "Breakfast", "Loved the breakfast today. The dining area was clean too.", student_id, 1),
        (3, 4, 4, 2, "Lunch", "Food was good, though the queue got long around 1 PM.", student_id, 1),
        (5, 5, 4, 5, "Dinner", "Great taste and friendly service.", student_id, 1),
        (4, 4, 4, 4, "Snacks", "Good snack options.", student_id, 1),
    ]
    connection.executemany(
        """INSERT INTO feedback
        (overall_rating, food_rating, cleanliness_rating, service_rating, meal, comments, user_id, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        seed_feedback,
    )
    connection.executemany(
        """INSERT INTO complaints
        (id, user_id, category, description, meal, priority, status, resolution, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        [
            ("SC-1042", student_id, "Taste", "Food taste is not good", "Lunch", "High", "Open", ""),
            ("SC-1041", student_id, "Waiting time", "Long waiting time at lunch", "Lunch", "Medium", "In Progress", ""),
            ("SC-1040", student_id, "Cleanliness", "Cleanliness issue near tables", "Lunch", "High", "Resolved", "Dining area cleaned and rechecked."),
            ("SC-1039", student_id, "Portion size", "Portion size is small", "Dinner", "Low", "Resolved", "Serving size reviewed."),
            ("SC-1038", student_id, "Waiting time", "Queue moved slowly", "Lunch", "Medium", "Open", ""),
            ("SC-1037", student_id, "Other", "Menu item unavailable", "Snacks", "Low", "Open", ""),
        ],
    )
    food = connection.execute(
        "INSERT INTO food_inspections (inspection_date, meal, inspector_id, inspector_name, score, remarks, is_demo) VALUES (date('now'), 'Lunch', ?, 'Jordan Taylor', 94, 'Presentation needs follow-up.', 1)",
        (inspector_id,),
    ).lastrowid
    hygiene = connection.execute(
        "INSERT INTO hygiene_inspections (inspection_date, inspector_id, inspector_name, score, remarks, is_demo) VALUES (date('now'), ?, 'Jordan Taylor', 94, 'Handwashing supplies replenished.', 1)",
        (inspector_id,),
    ).lastrowid
    food_items = [
        ("Food freshness", "Pass"), ("Taste", "Pass"), ("Serving temperature", "Pass"),
        ("Portion size", "Pass"), ("Presentation", "Needs Improvement"),
        ("Ingredient quality", "Pass"), ("Storage conditions", "Pass"),
    ]
    hygiene_items = [
        (name, "Needs Improvement" if name == "Handwashing facilities" else "Compliant")
        for name in (
            "Dining area cleanliness", "Tables and chairs", "Kitchen cleanliness", "Handwashing facilities",
            "Waste disposal", "Pest control", "Food storage", "Staff hygiene",
        )
    ]
    connection.executemany(
        "INSERT INTO inspection_items (food_inspection_id, item_name, status) VALUES (?, ?, ?)",
        [(food, name, status) for name, status in food_items],
    )
    connection.executemany(
        "INSERT INTO inspection_items (hygiene_inspection_id, item_name, status) VALUES (?, ?, ?)",
        [(hygiene, name, status) for name, status in hygiene_items],
    )
    connection.executemany(
        """INSERT INTO improvement_plans
        (title, problem, target, corrective_action, baseline, result, due_date, stage, status, progress, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        [
            ("Reduce lunch wait times", "Lunch queue is too long", "Average service time under 8 minutes", "Add a dedicated serving station.", "10 minutes", "6 minutes", "2026-10-28", "Do", "In Progress", 42),
            ("Improve food freshness checks", "Freshness concerns in feedback", "Record freshness check before each service", "Add and train staff on a freshness checklist.", "12 complaints", "5 complaints", "2026-10-24", "Check", "Checking results", 75),
        ],
    )
    connection.executemany(
        "INSERT INTO menu_items (menu_date, meal, name, description, price, is_demo) VALUES (date('now'), ?, ?, ?, ?, 1)",
        [
            ("Breakfast", "Masala oats & fresh fruit", "Whole grain · Vegetarian", 45),
            ("Breakfast", "Veg grilled sandwich", "Fresh vegetables · Vegetarian", 55),
            ("Lunch", "Paneer tikka bowl", "Jeera rice · Salad · Vegetarian", 90),
            ("Lunch", "Dal tadka & rice", "Freshly prepared · Vegetarian", 70),
            ("Snacks", "Vegetable samosa", "Mint chutney · Vegetarian", 25),
        ],
    )
    connection.execute(
        "INSERT INTO corrective_actions (title, description, due_date, status, hygiene_inspection_id) VALUES (?, ?, date('now', '+1 day'), 'Open', ?)",
        ("Restock handwashing supplies", "Check soap and paper towel supplies at opening.", hygiene),
    )
