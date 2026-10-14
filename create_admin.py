"""Provision the first administrator in an empty SQLite database."""

from __future__ import annotations

import getpass
import re
import sys

from werkzeug.security import generate_password_hash

from database import get_db, initialize_database


def main() -> int:
    initialize_database(seed=False)
    username = input("Admin username: ").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,80}", username):
        print("Username must be 3-80 characters: letters, numbers, dot, underscore, or hyphen.", file=sys.stderr)
        return 1
    display_name = input("Admin display name: ").strip()
    if not display_name or len(display_name) > 100:
        print("Display name is required and must be at most 100 characters.", file=sys.stderr)
        return 1
    password = getpass.getpass("Admin password (at least 12 characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if len(password) < 12:
        print("Password must have at least 12 characters.", file=sys.stderr)
        return 1
    if password != confirmation:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    with get_db() as connection:
        if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            print("Bootstrap is only allowed when the user database is empty.", file=sys.stderr)
            return 1
        connection.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'Admin')",
            (username, generate_password_hash(password), display_name),
        )
    print(f"Administrator '{username}' created. You can now start the application.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
