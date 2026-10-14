"""Flask entry point for the Smart Canteen Quality Monitoring System."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from functools import wraps
from io import BytesIO, StringIO
import csv
import json
import math
import secrets
import sqlite3
import statistics

from flask import Flask, abort, jsonify, redirect, render_template, request, send_file, send_from_directory, session, url_for
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from werkzeug.security import check_password_hash, generate_password_hash

from database import BASE_DIR, get_db, initialize_database

app = Flask(__name__, static_folder="assets", static_url_path="/assets")
app.config.update(
    SECRET_KEY=os.environ.get("CANTEEN_SECRET_KEY") or secrets.token_hex(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("CANTEEN_HTTPS", "0") == "1",
    MAX_CONTENT_LENGTH=1024 * 1024,
)
initialize_database(seed=os.environ.get("CANTEEN_SEED_DEMO", "1") != "0")


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.path == "/" or request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response

MEALS = {"Breakfast", "Lunch", "Snacks", "Dinner"}
FOOD_STATUSES = {"Pass", "Needs Improvement", "Fail"}
HYGIENE_STATUSES = {"Compliant", "Needs Improvement", "Non-Compliant"}
COMPLAINT_CATEGORIES = {"Taste", "Freshness", "Cleanliness", "Waiting time", "Portion size", "Staff behaviour", "Other"}
ROLES = {"Admin", "Manager", "Inspector", "Student"}
FOOD_ITEMS = {"Food freshness", "Taste", "Serving temperature", "Portion size", "Presentation", "Ingredient quality", "Storage conditions"}
HYGIENE_ITEMS = {"Dining area cleanliness", "Tables and chairs", "Kitchen cleanliness", "Handwashing facilities", "Waste disposal", "Pest control", "Food storage", "Staff hygiene"}


def current_user() -> dict | None:
    user_id = session.get("user_id")
    if not user_id:
        return None
    with get_db() as connection:
        row = connection.execute("SELECT id, username, display_name, role FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def require_roles(*roles: str):
    def decorator(handler):
        @wraps(handler)
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user:
                if request.path.startswith("/api/"):
                    return jsonify(error="Authentication required."), 401
                return redirect(url_for("login_page", next=request.path))
            if user["role"] not in roles:
                if request.path.startswith("/api/"):
                    return jsonify(error="You do not have permission to perform this action."), 403
                abort(403)
            request.user = user
            return handler(*args, **kwargs)
        return wrapped
    return decorator


def json_body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object.")
    return body


def required_text(body: dict, key: str, label: str, maximum: int) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError(f"{label} is required and must be at most {maximum} characters.")
    return value.strip()


def bounded_rating(body: dict, key: str) -> int:
    value = body.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
        raise ValueError(f"{key} must be an integer from 1 to 5.")
    return value


def api_error(message: str, status: int = 400):
    return jsonify(error=message), status


def inspection_score(items: list[dict], kind: str) -> int:
    if not items:
        raise ValueError("At least one inspection item is required.")
    valid_names = FOOD_ITEMS if kind == "food" else HYGIENE_ITEMS
    valid_statuses = FOOD_STATUSES if kind == "food" else HYGIENE_STATUSES
    mapping = {"Pass": 100, "Needs Improvement": 60, "Fail": 0} if kind == "food" else {"Compliant": 100, "Needs Improvement": 50, "Non-Compliant": 0}
    seen = set()
    scores = []
    for item in items:
        if not isinstance(item, dict) or item.get("name") not in valid_names or item.get("name") in seen:
            raise ValueError("Inspection contains an unknown or duplicate checklist item.")
        if item.get("status") not in valid_statuses:
            raise ValueError(f"Invalid status for {item.get('name', 'inspection item')}.")
        remark = item.get("remarks", "")
        if not isinstance(remark, str) or len(remark) > 500:
            raise ValueError("Each inspection remark must be at most 500 characters.")
        seen.add(item["name"])
        scores.append(mapping[item["status"]])
    if seen != valid_names:
        raise ValueError("Submit every required inspection checklist item.")
    return int(sum(scores) / len(scores) + 0.5)


def query_rows(sql: str, parameters: tuple = ()) -> list[dict]:
    with get_db() as connection:
        return [dict(row) for row in connection.execute(sql, parameters).fetchall()]


@app.get("/assets/<path:filename>")
def assets(filename: str):
    return send_from_directory(BASE_DIR / "assets", filename)


@app.get("/login")
def login_page():
    return render_template("login.html")


@app.get("/")
@require_roles("Admin", "Manager", "Inspector", "Student")
def admin_page():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/student")
@require_roles("Student")
def student_page():
    return redirect(url_for("admin_page", app="student"))


@app.get("/api/auth/me")
def auth_me():
    user = current_user()
    return jsonify(user=user)


@app.post("/api/auth/login")
def auth_login():
    try:
        body = json_body()
        username = required_text(body, "username", "Username", 80)
        password = required_text(body, "password", "Password", 200)
    except ValueError as error:
        return api_error(str(error))
    with get_db() as connection:
        user = connection.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return api_error("Username or password is incorrect.", 401)
    session.clear()
    session["user_id"] = user["id"]
    return jsonify(user={"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"]})


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/auth/users")
@require_roles("Admin")
def create_user():
    try:
        body = json_body()
        username = required_text(body, "username", "Username", 80)
        password = required_text(body, "password", "Password", 200)
        name = required_text(body, "display_name", "Display name", 100)
        role = body.get("role")
        if role not in ROLES:
            raise ValueError("Role must be Admin, Manager, Inspector, or Student.")
        if len(password) < 8:
            raise ValueError("Password must have at least 8 characters.")
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
                (username, generate_password_hash(password), name, role),
            )
        return jsonify(id=cursor.lastrowid, username=username, role=role), 201
    except sqlite3.IntegrityError:
        return api_error("That username is already registered.", 409)
    except ValueError as error:
        return api_error(str(error))


@app.get("/api/dashboard")
@require_roles("Admin", "Manager", "Inspector")
def dashboard_data():
    days = request.args.get("days", "7")
    if days not in {"7", "30"}:
        return api_error("Dashboard range must be 7 or 30 days.")
    interval = f"-{int(days) - 1} days"
    with get_db() as connection:
        feedback_summary = connection.execute("SELECT COUNT(*) AS count, AVG(overall_rating) AS average FROM feedback").fetchone()
        complaint_summary = connection.execute("SELECT COUNT(*) AS total, SUM(status IN ('Open', 'In Progress')) AS open FROM complaints").fetchone()
        food_score = connection.execute("SELECT score FROM food_inspections ORDER BY inspection_date DESC, id DESC LIMIT 1").fetchone()
        hygiene_score = connection.execute("SELECT score FROM hygiene_inspections ORDER BY inspection_date DESC, id DESC LIMIT 1").fetchone()
        statuses = connection.execute("SELECT status, COUNT(*) AS count FROM complaints GROUP BY status").fetchall()
        food_distribution = connection.execute("SELECT status, COUNT(*) AS count FROM inspection_items WHERE food_inspection_id IS NOT NULL GROUP BY status").fetchall()
        hygiene_distribution = connection.execute("SELECT status, COUNT(*) AS count FROM inspection_items WHERE hygiene_inspection_id IS NOT NULL GROUP BY status").fetchall()
        categories = connection.execute("SELECT category, COUNT(*) AS count FROM complaints GROUP BY category ORDER BY count DESC").fetchall()
        trend = connection.execute(
            """SELECT date(created_at) AS day, ROUND(AVG(overall_rating), 2) AS average
            FROM feedback WHERE date(created_at) >= date('now', ?)
            GROUP BY date(created_at) ORDER BY day"""
        , (interval,)).fetchall()
        service_time = connection.execute(
            "SELECT ROUND(AVG(duration_minutes), 1) AS average, COUNT(*) AS count FROM service_time_records"
        ).fetchone()
        recent = connection.execute(
            """SELECT c.id, c.created_at, c.category, c.description, c.priority, c.status,
            COALESCE(s.name, 'Unassigned') AS assigned
            FROM complaints c LEFT JOIN staff s ON s.id = c.assigned_staff_id
            ORDER BY c.created_at DESC LIMIT 10"""
        ).fetchall()
        return jsonify(
            food_quality_score=round(food_score["score"]) if food_score else None,
            hygiene_score=round(hygiene_score["score"]) if hygiene_score else None,
            satisfaction=round(feedback_summary["average"], 1) if feedback_summary["average"] else None,
            average_service_time=service_time["average"],
            service_time_count=service_time["count"],
            feedback_count=feedback_summary["count"],
            complaints_total=complaint_summary["total"],
            complaints_open=complaint_summary["open"] or 0,
            complaint_status={row["status"]: row["count"] for row in statuses},
            food_quality_distribution={row["status"]: row["count"] for row in food_distribution},
            hygiene_performance={row["status"]: row["count"] for row in hygiene_distribution},
            complaint_categories=[dict(row) for row in categories],
            satisfaction_trend=[dict(row) for row in trend],
            recent_complaints=[dict(row) for row in recent],
            demo_mode=bool(connection.execute("SELECT 1 FROM feedback WHERE is_demo = 1 LIMIT 1").fetchone()),
        )


@app.post("/api/service-times")
@require_roles("Admin", "Manager", "Inspector")
def create_service_time():
    try:
        body = json_body()
        duration = body.get("duration_minutes")
        meal = body.get("meal")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0 or duration > 240 or not math.isfinite(duration):
            raise ValueError("Service time must be a number greater than 0 and no more than 240 minutes.")
        if meal not in MEALS:
            raise ValueError("Select a valid meal.")
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO service_time_records (duration_minutes, meal, recorded_by) VALUES (?, ?, ?)",
                (duration, meal, request.user["id"]),
            )
        return jsonify(id=cursor.lastrowid, duration_minutes=duration), 201
    except ValueError as error:
        return api_error(str(error))


@app.get("/api/feedback")
@require_roles("Admin", "Manager", "Inspector")
def list_feedback():
    meal = request.args.get("meal")
    if meal and meal not in MEALS:
        return api_error("Unknown meal filter.")
    sql = """SELECT f.id, f.overall_rating, f.food_rating, f.cleanliness_rating,
    f.service_rating, f.meal, f.comments, f.created_at
    FROM feedback f"""
    parameters: tuple = ()
    if meal:
        sql += " WHERE f.meal = ?"
        parameters = (meal,)
    sql += " ORDER BY f.created_at DESC LIMIT 200"
    return jsonify(items=query_rows(sql, parameters))


@app.post("/api/feedback")
@require_roles("Student")
def submit_feedback():
    try:
        body = json_body()
        overall = bounded_rating(body, "overall_rating")
        food = bounded_rating(body, "food_rating")
        cleanliness = bounded_rating(body, "cleanliness_rating")
        service = bounded_rating(body, "service_rating")
        meal = body.get("meal")
        if meal not in MEALS:
            raise ValueError("Select a valid meal.")
        comments = body.get("comments", "")
        if not isinstance(comments, str) or len(comments) > 200:
            raise ValueError("Comments must be at most 200 characters.")
        with get_db() as connection:
            cursor = connection.execute(
                """INSERT INTO feedback (user_id, overall_rating, food_rating, cleanliness_rating, service_rating, meal, comments)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (request.user["id"], overall, food, cleanliness, service, meal, comments.strip()),
            )
        return jsonify(id=cursor.lastrowid, message="Feedback submitted. Thank you."), 201
    except ValueError as error:
        return api_error(str(error))


@app.get("/api/feedback/mine")
@require_roles("Student")
def my_feedback():
    return jsonify(items=query_rows(
        """SELECT id, overall_rating, food_rating, cleanliness_rating, service_rating, meal, comments, created_at
        FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 100""",
        (request.user["id"],),
    ))


@app.get("/api/student/summary")
@require_roles("Student")
def student_summary():
    with get_db() as connection:
        food = connection.execute("SELECT score FROM food_inspections ORDER BY inspection_date DESC, id DESC LIMIT 1").fetchone()
        hygiene = connection.execute("SELECT score FROM hygiene_inspections ORDER BY inspection_date DESC, id DESC LIMIT 1").fetchone()
        satisfaction = connection.execute("SELECT ROUND(AVG(overall_rating), 1) AS average FROM feedback").fetchone()
        complaint = connection.execute(
            "SELECT id, category, status FROM complaints WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (request.user["id"],),
        ).fetchone()
    return jsonify(
        food_quality_score=round(food["score"]) if food else None,
        hygiene_score=round(hygiene["score"]) if hygiene else None,
        satisfaction=satisfaction["average"],
        latest_complaint=dict(complaint) if complaint else None,
    )


@app.get("/api/complaints")
@require_roles("Admin", "Manager", "Inspector")
def list_complaints():
    clauses = []
    params: list[str] = []
    for key, allowed, column in (
        ("status", {"Open", "In Progress", "Resolved"}, "c.status"),
        ("priority", {"Low", "Medium", "High"}, "c.priority"),
        ("category", COMPLAINT_CATEGORIES, "c.category"),
    ):
        value = request.args.get(key)
        if value:
            if value not in allowed:
                return api_error(f"Invalid {key} filter.")
            clauses.append(f"{column} = ?")
            params.append(value)
    start = request.args.get("start")
    end = request.args.get("end")
    for value in (start, end):
        if value:
            try:
                date.fromisoformat(value)
            except ValueError:
                return api_error("Date filters must use YYYY-MM-DD.")
    if start:
        clauses.append("date(c.created_at) >= date(?)")
        params.append(start)
    if end:
        clauses.append("date(c.created_at) <= date(?)")
        params.append(end)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = query_rows(
        f"""SELECT c.id, c.category, c.description, c.meal, c.priority, c.status, c.resolution,
        c.created_at, s.name AS assigned_staff
        FROM complaints c LEFT JOIN staff s ON c.assigned_staff_id = s.id {where}
        ORDER BY c.created_at DESC LIMIT 500""",
        tuple(params),
    )
    return jsonify(items=rows)


@app.post("/api/complaints")
@require_roles("Student")
def submit_complaint():
    try:
        body = json_body()
        category = body.get("category")
        if category not in COMPLAINT_CATEGORIES:
            raise ValueError("Select a valid complaint category.")
        description = required_text(body, "description", "Description", 500)
        if len(description) < 3:
            raise ValueError("Description must have at least 3 characters.")
        meal = body.get("meal")
        if meal not in MEALS:
            raise ValueError("Select a valid meal.")
        with get_db() as connection:
            complaint_id = f"SC-{datetime.now().strftime('%y%m%d')}-{secrets.token_hex(3).upper()}"
            connection.execute(
                "INSERT INTO complaints (id, user_id, category, description, meal) VALUES (?, ?, ?, ?, ?)",
                (complaint_id, request.user["id"], category, description, meal),
            )
        return jsonify(id=complaint_id, status="Open", message="Complaint submitted."), 201
    except ValueError as error:
        return api_error(str(error))


@app.get("/api/complaints/<complaint_id>")
@require_roles("Admin", "Manager", "Inspector", "Student")
def get_complaint(complaint_id: str):
    with get_db() as connection:
        row = connection.execute(
            """SELECT c.id, c.category, c.description, c.meal, c.priority, c.status, c.resolution, c.created_at,
            s.name AS assigned_staff FROM complaints c LEFT JOIN staff s ON c.assigned_staff_id = s.id WHERE c.id = ?""",
            (complaint_id,),
        ).fetchone()
    if not row:
        return api_error("Complaint not found.", 404)
    if request.user["role"] == "Student":
        with get_db() as connection:
            owner = connection.execute("SELECT user_id FROM complaints WHERE id = ?", (complaint_id,)).fetchone()
        if owner["user_id"] != request.user["id"]:
            return api_error("Complaint not found.", 404)
    return jsonify(item=dict(row))


@app.get("/api/complaints/mine")
@require_roles("Student")
def my_complaints():
    return jsonify(items=query_rows(
        """SELECT id, category, description, meal, priority, status, resolution, created_at
        FROM complaints WHERE user_id = ? ORDER BY created_at DESC LIMIT 100""",
        (request.user["id"],),
    ))


@app.patch("/api/complaints/<complaint_id>")
@require_roles("Admin", "Manager", "Inspector")
def update_complaint(complaint_id: str):
    try:
        body = json_body()
        fields = []
        values: list[object] = []
        if "status" in body:
            if body["status"] not in {"Open", "In Progress", "Resolved"}:
                raise ValueError("Choose Open, In Progress, or Resolved.")
            fields.append("status = ?")
            values.append(body["status"])
        if "resolution" in body:
            resolution = body["resolution"]
            if not isinstance(resolution, str) or len(resolution) > 1000:
                raise ValueError("Resolution must be at most 1000 characters.")
            fields.append("resolution = ?")
            values.append(resolution.strip())
        if "assigned_staff_id" in body:
            staff_id = body["assigned_staff_id"]
            if staff_id is not None and (isinstance(staff_id, bool) or not isinstance(staff_id, int)):
                raise ValueError("Assigned staff ID must be an integer or null.")
            if staff_id is not None:
                with get_db() as connection:
                    if not connection.execute("SELECT 1 FROM staff WHERE id = ? AND active = 1", (staff_id,)).fetchone():
                        raise ValueError("Assigned staff member was not found or is inactive.")
            fields.append("assigned_staff_id = ?")
            values.append(staff_id)
        if not fields:
            raise ValueError("Provide a status, resolution, or staff assignment to update.")
        if body.get("status") == "Resolved":
            resolution = body.get("resolution")
            if resolution is None:
                with get_db() as connection:
                    current = connection.execute("SELECT resolution FROM complaints WHERE id = ?", (complaint_id,)).fetchone()
                resolution = current["resolution"] if current else ""
            if not resolution or not resolution.strip():
                raise ValueError("Record a resolution before closing this complaint.")
        fields.append("updated_at = CURRENT_TIMESTAMP")
        values.append(complaint_id)
        with get_db() as connection:
            cursor = connection.execute(f"UPDATE complaints SET {', '.join(fields)} WHERE id = ?", values)
            updated = connection.execute("SELECT id, status, resolution FROM complaints WHERE id = ?", (complaint_id,)).fetchone() if cursor.rowcount else None
        if cursor.rowcount == 0:
            return api_error("Complaint not found.", 404)
        return jsonify(item=dict(updated))
    except (ValueError, sqlite3.IntegrityError) as error:
        return api_error(str(error))


def _save_inspection(kind: str):
    try:
        body = json_body()
        inspection_date = body.get("date")
        date.fromisoformat(inspection_date)
        meal = body.get("meal")
        if kind == "food" and meal not in MEALS:
            raise ValueError("Select a valid meal.")
        name = required_text(body, "inspector_name", "Inspector name", 100)
        remarks = body.get("remarks", "")
        if not isinstance(remarks, str) or len(remarks) > 1000:
            raise ValueError("Remarks must be at most 1000 characters.")
        items = body.get("items")
        if not isinstance(items, list):
            raise ValueError("Checklist items are required.")
        score = inspection_score(items, kind)
        table = "food_inspections" if kind == "food" else "hygiene_inspections"
        id_field = "food_inspection_id" if kind == "food" else "hygiene_inspection_id"
        with get_db() as connection:
            if kind == "food":
                cursor = connection.execute(
                    f"INSERT INTO {table} (inspection_date, meal, inspector_id, inspector_name, score, remarks) VALUES (?, ?, ?, ?, ?, ?)",
                    (inspection_date, meal, request.user["id"], name, score, remarks.strip()),
                )
            else:
                cursor = connection.execute(
                    f"INSERT INTO {table} (inspection_date, inspector_id, inspector_name, score, remarks) VALUES (?, ?, ?, ?, ?)",
                    (inspection_date, request.user["id"], name, score, remarks.strip()),
                )
            inspection_id = cursor.lastrowid
            connection.executemany(
                f"INSERT INTO inspection_items ({id_field}, item_name, status, remarks) VALUES (?, ?, ?, ?)",
                [(inspection_id, item["name"], item["status"], item.get("remarks", "").strip()) for item in items],
            )
            failed = [item for item in items if item["status"] in {"Fail", "Non-Compliant"}]
            for item in failed:
                connection.execute(
                    f"INSERT INTO corrective_actions (title, description, {id_field}) VALUES (?, ?, ?)",
                    (f"Correct inspection failure: {item['name']}", item.get("remarks", "") or f"Follow up on {item['name']}.", inspection_id),
                )
        return jsonify(id=inspection_id, score=score, flagged_items=[item["name"] for item in failed]), 201
    except (ValueError, TypeError) as error:
        return api_error(str(error) or "Invalid inspection.")


@app.post("/api/inspections/food")
@require_roles("Admin", "Manager", "Inspector")
def create_food_inspection():
    return _save_inspection("food")


@app.post("/api/inspections/hygiene")
@require_roles("Admin", "Manager", "Inspector")
def create_hygiene_inspection():
    return _save_inspection("hygiene")


@app.get("/api/inspections/<kind>")
@require_roles("Admin", "Manager", "Inspector")
def inspection_history(kind: str):
    if kind == "food":
        table = "food_inspections"
        columns = "id, inspection_date, meal, inspector_name, score, remarks"
    elif kind == "hygiene":
        table = "hygiene_inspections"
        columns = "id, inspection_date, inspector_name, score, remarks"
    else:
        return api_error("Inspection type must be food or hygiene.")
    rows = query_rows(f"SELECT {columns} FROM {table} ORDER BY inspection_date DESC, id DESC LIMIT 100")
    id_field = "food_inspection_id" if kind == "food" else "hygiene_inspection_id"
    for row in rows:
        row["items"] = query_rows(
            f"SELECT item_name, status, remarks FROM inspection_items WHERE {id_field} = ? ORDER BY id",
            (row["id"],),
        )
    return jsonify(items=rows)


@app.get("/api/tqm")
@require_roles("Admin", "Manager", "Inspector")
def tqm_analysis():
    with get_db() as connection:
        categories = connection.execute("SELECT category, COUNT(*) AS count FROM complaints GROUP BY category ORDER BY count DESC").fetchall()
        defects = connection.execute(
            """SELECT item_name, status, COUNT(*) AS count FROM inspection_items
            WHERE status IN ('Needs Improvement', 'Fail', 'Non-Compliant')
            GROUP BY item_name, status ORDER BY count DESC"""
        ).fetchall()
        plans = connection.execute(
            "SELECT id, title, problem, target, corrective_action, baseline, result, due_date, stage, status, progress FROM improvement_plans ORDER BY id DESC"
        ).fetchall()
        staff = connection.execute(
            """SELECT s.id, s.name, s.position, COUNT(ca.id) AS assigned_tasks,
            SUM(ca.status = 'Completed') AS completed_tasks FROM staff s LEFT JOIN corrective_actions ca ON ca.assigned_staff_id = s.id
            WHERE s.active = 1 GROUP BY s.id"""
        ).fetchall()
        fishbone = connection.execute(
            "SELECT id, problem, category, cause, created_at FROM fishbone_causes ORDER BY id DESC"
        ).fetchall()
        recent_whys = connection.execute(
            "SELECT id, problem, whys_json, root_cause, created_at FROM five_whys ORDER BY id DESC LIMIT 20"
        ).fetchall()
        return jsonify(
            complaint_categories=[dict(row) for row in categories],
            check_sheet=[dict(row) for row in defects],
            improvement_plans=[dict(row) for row in plans],
            staff_performance=[dict(row) for row in staff],
            fishbone_causes=[dict(row) for row in fishbone],
            five_whys=[{**dict(row), "whys": json.loads(row["whys_json"])} for row in recent_whys],
            fishbone_categories=["People", "Methods", "Machines", "Materials", "Environment"],
        )


@app.get("/api/tqm/control-chart")
@require_roles("Admin", "Manager", "Inspector")
def control_chart():
    metric = request.args.get("metric", "overall_rating")
    if metric == "overall_rating":
        rows = query_rows("SELECT date(created_at) AS day, overall_rating AS value FROM feedback ORDER BY created_at")
        lower, upper = 1, 5
    elif metric == "food_quality":
        rows = query_rows("SELECT inspection_date AS day, score AS value FROM food_inspections ORDER BY inspection_date, id")
        lower, upper = 0, 100
    elif metric == "hygiene":
        rows = query_rows("SELECT inspection_date AS day, score AS value FROM hygiene_inspections ORDER BY inspection_date, id")
        lower, upper = 0, 100
    else:
        return api_error("Choose overall_rating, food_quality, or hygiene.")
    values = [float(row["value"]) for row in rows]
    if len(values) < 20:
        return jsonify(metric=metric, points=rows, sufficient_data=False, observations=len(values), explanation="At least 20 observations are required before calculating control limits.")
    mean = statistics.mean(values)
    sigma = statistics.pstdev(values)
    return jsonify(
        metric=metric, points=rows, sufficient_data=True, observations=len(values),
        center_line=round(mean, 2), lower_control_limit=round(max(lower, mean - 3 * sigma), 2),
        upper_control_limit=round(min(upper, mean + 3 * sigma), 2),
        explanation="Limits use the mean ± 3 population standard deviations and are bounded by the metric scale.",
    )


@app.post("/api/analysis/five-whys")
@require_roles("Admin", "Manager", "Inspector")
def save_five_whys():
    try:
        body = json_body()
        problem = required_text(body, "problem", "Problem", 300)
        whys = body.get("whys")
        if not isinstance(whys, list) or not 1 <= len(whys) <= 5 or any(not isinstance(why, str) or not why.strip() or len(why) > 300 for why in whys):
            raise ValueError("Provide one to five non-empty why statements (maximum 300 characters each).")
        root_cause = body.get("root_cause", "")
        if not isinstance(root_cause, str) or len(root_cause) > 300:
            raise ValueError("Root cause must be at most 300 characters.")
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO five_whys (problem, whys_json, root_cause, created_by) VALUES (?, ?, ?, ?)",
                (problem, json.dumps([why.strip() for why in whys]), root_cause.strip(), request.user["id"]),
            )
        return jsonify(id=cursor.lastrowid), 201
    except ValueError as error:
        return api_error(str(error))


@app.post("/api/analysis/fishbone")
@require_roles("Admin", "Manager", "Inspector")
def save_fishbone_cause():
    try:
        body = json_body()
        problem = required_text(body, "problem", "Problem", 300)
        category = body.get("category")
        if category not in {"People", "Methods", "Machines", "Materials", "Environment"}:
            raise ValueError("Choose a valid fishbone category.")
        cause = required_text(body, "cause", "Cause", 300)
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO fishbone_causes (problem, category, cause, created_by) VALUES (?, ?, ?, ?)",
                (problem, category, cause, request.user["id"]),
            )
        return jsonify(id=cursor.lastrowid), 201
    except ValueError as error:
        return api_error(str(error))


@app.post("/api/improvements")
@require_roles("Admin", "Manager")
def create_improvement_plan():
    try:
        body = json_body()
        title = required_text(body, "title", "Title", 150)
        problem = required_text(body, "problem", "Problem", 500)
        target = required_text(body, "target", "Target", 500)
        action = body.get("corrective_action", "")
        if not isinstance(action, str) or len(action) > 1000:
            raise ValueError("Corrective action must be at most 1000 characters.")
        due = body.get("due_date") or None
        if due:
            date.fromisoformat(due)
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO improvement_plans (title, problem, target, corrective_action, due_date, status, progress) VALUES (?, ?, ?, ?, ?, 'Planned', 0)",
                (title, problem, target, action.strip(), due),
            )
        return jsonify(id=cursor.lastrowid), 201
    except (ValueError, TypeError) as error:
        return api_error(str(error))


@app.patch("/api/improvements/<int:plan_id>")
@require_roles("Admin", "Manager")
def update_improvement_plan(plan_id: int):
    try:
        body = json_body()
        allowed = {
            "stage": {"Plan", "Do", "Check", "Act", "Completed"},
            "status": {"Planned", "In Progress", "Checking results", "Completed"},
        }
        fields = []
        values: list[object] = []
        for field, values_allowed in allowed.items():
            if field in body:
                if body[field] not in values_allowed:
                    raise ValueError(f"Invalid {field}.")
                fields.append(f"{field} = ?")
                values.append(body[field])
        if "progress" in body:
            progress = body["progress"]
            if isinstance(progress, bool) or not isinstance(progress, int) or not 0 <= progress <= 100:
                raise ValueError("Progress must be an integer from 0 to 100.")
            fields.append("progress = ?")
            values.append(progress)
        for field in ("corrective_action", "baseline", "result"):
            if field in body:
                value = body[field]
                if not isinstance(value, str) or len(value) > 1000:
                    raise ValueError(f"{field} must be text up to 1000 characters.")
                fields.append(f"{field} = ?")
                values.append(value.strip())
        if not fields:
            raise ValueError("Provide at least one plan field to update.")
        values.append(plan_id)
        with get_db() as connection:
            cursor = connection.execute(f"UPDATE improvement_plans SET {', '.join(fields)} WHERE id = ?", values)
        if cursor.rowcount == 0:
            return api_error("Improvement plan not found.", 404)
        return jsonify(ok=True)
    except ValueError as error:
        return api_error(str(error))


@app.get("/api/staff")
@require_roles("Admin", "Manager")
def list_staff():
    return jsonify(items=query_rows(
        """SELECT s.id, s.name, s.position, s.active, COUNT(ca.id) AS assigned_tasks,
        COALESCE(SUM(ca.status = 'Completed'), 0) AS completed_tasks
        FROM staff s LEFT JOIN corrective_actions ca ON ca.assigned_staff_id = s.id
        GROUP BY s.id ORDER BY s.name"""
    ))


@app.get("/api/corrective-actions")
@require_roles("Admin", "Manager", "Inspector")
def list_corrective_actions():
    return jsonify(items=query_rows(
        """SELECT ca.id, ca.title, ca.description, ca.due_date, ca.status,
        ca.assigned_staff_id, s.name AS assigned_staff
        FROM corrective_actions ca LEFT JOIN staff s ON s.id = ca.assigned_staff_id
        ORDER BY CASE ca.status WHEN 'Open' THEN 1 WHEN 'In Progress' THEN 2 ELSE 3 END, ca.due_date"""
    ))


@app.patch("/api/corrective-actions/<int:action_id>")
@require_roles("Admin", "Manager", "Inspector")
def update_corrective_action(action_id: int):
    try:
        body = json_body()
        fields = []
        values: list[object] = []
        if "status" in body:
            if body["status"] not in {"Open", "In Progress", "Completed"}:
                raise ValueError("Status must be Open, In Progress, or Completed.")
            fields.append("status = ?")
            values.append(body["status"])
        if "assigned_staff_id" in body:
            staff_id = body["assigned_staff_id"]
            if staff_id is not None and (isinstance(staff_id, bool) or not isinstance(staff_id, int)):
                raise ValueError("Assigned staff ID must be an integer or null.")
            fields.append("assigned_staff_id = ?")
            values.append(staff_id)
        if "due_date" in body:
            due_date = body["due_date"]
            if due_date:
                date.fromisoformat(due_date)
            fields.append("due_date = ?")
            values.append(due_date or None)
        if not fields:
            raise ValueError("Provide a task status, staff assignment, or due date.")
        values.append(action_id)
        with get_db() as connection:
            cursor = connection.execute(f"UPDATE corrective_actions SET {', '.join(fields)} WHERE id = ?", values)
        if not cursor.rowcount:
            return api_error("Corrective action not found.", 404)
        return jsonify(ok=True)
    except (ValueError, TypeError, sqlite3.IntegrityError) as error:
        return api_error(str(error))


@app.post("/api/staff")
@require_roles("Admin", "Manager")
def create_staff():
    try:
        body = json_body()
        name = required_text(body, "name", "Name", 100)
        position = body.get("position", "Canteen staff")
        if not isinstance(position, str) or not position.strip() or len(position) > 100:
            raise ValueError("Position is required and must be at most 100 characters.")
        with get_db() as connection:
            cursor = connection.execute("INSERT INTO staff (name, position) VALUES (?, ?)", (name, position.strip()))
        return jsonify(id=cursor.lastrowid), 201
    except ValueError as error:
        return api_error(str(error))


@app.post("/api/corrective-actions")
@require_roles("Admin", "Manager", "Inspector")
def create_corrective_action():
    try:
        body = json_body()
        title = required_text(body, "title", "Title", 200)
        description = body.get("description", "")
        if not isinstance(description, str) or len(description) > 1000:
            raise ValueError("Description must be at most 1000 characters.")
        due_date = body.get("due_date") or None
        if due_date:
            date.fromisoformat(due_date)
        assigned_staff_id = body.get("assigned_staff_id")
        if assigned_staff_id is not None and (isinstance(assigned_staff_id, bool) or not isinstance(assigned_staff_id, int)):
            raise ValueError("Assigned staff ID must be an integer or null.")
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO corrective_actions (title, description, assigned_staff_id, due_date) VALUES (?, ?, ?, ?)",
                (title, description.strip(), assigned_staff_id, due_date),
            )
        return jsonify(id=cursor.lastrowid), 201
    except (ValueError, TypeError, sqlite3.IntegrityError) as error:
        return api_error(str(error))


def _report_rows(report_type: str, start: str, end: str) -> tuple[list[str], list[list[object]], str]:
    date.fromisoformat(start)
    date.fromisoformat(end)
    if start > end:
        raise ValueError("Start date must be on or before end date.")
    filters = (start, end)
    definitions = {
        "feedback": (
            "Student Feedback Summary",
            ["Date", "Meal", "Overall rating", "Food rating", "Cleanliness rating", "Service rating", "Comments"],
            "SELECT date(created_at), meal, overall_rating, food_rating, cleanliness_rating, service_rating, comments FROM feedback WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at",
        ),
        "food": (
            "Food Quality Inspection Report",
            ["Date", "Meal", "Inspector", "Score (%)", "Remarks"],
            "SELECT inspection_date, meal, inspector_name, score, remarks FROM food_inspections WHERE inspection_date BETWEEN ? AND ? ORDER BY inspection_date",
        ),
        "hygiene": (
            "Hygiene Compliance Report",
            ["Date", "Inspector", "Compliance (%)", "Remarks"],
            "SELECT inspection_date, inspector_name, score, remarks FROM hygiene_inspections WHERE inspection_date BETWEEN ? AND ? ORDER BY inspection_date",
        ),
        "complaints": (
            "Complaint Analysis Report",
            ["ID", "Date", "Category", "Description", "Priority", "Status", "Resolution"],
            "SELECT id, date(created_at), category, description, priority, status, resolution FROM complaints WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at",
        ),
        "satisfaction": (
            "Student Satisfaction Report",
            ["Date", "Meal", "Average rating", "Responses"],
            "SELECT date(created_at), meal, ROUND(AVG(overall_rating), 2), COUNT(*) FROM feedback WHERE date(created_at) BETWEEN ? AND ? GROUP BY date(created_at), meal ORDER BY date(created_at)",
        ),
        "improvements": (
            "PDCA Improvement Report",
            ["ID", "Plan", "Problem", "Target", "Stage", "Status", "Progress (%)", "Baseline", "Result"],
            "SELECT id, title, problem, target, stage, status, progress, baseline, result FROM improvement_plans WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at",
        ),
    }
    if report_type not in definitions:
        raise ValueError("Unknown report type.")
    title, headers, sql = definitions[report_type]
    return headers, [list(row.values()) for row in query_rows(sql, filters)], title


@app.get("/api/reports/<report_type>")
@require_roles("Admin", "Manager")
def export_report(report_type: str):
    start = request.args.get("start", (date.today() - timedelta(days=30)).isoformat())
    end = request.args.get("end", date.today().isoformat())
    export_format = request.args.get("format", "csv").lower()
    try:
        headers, rows, title = _report_rows(report_type, start, end)
        if export_format == "csv":
            content = StringIO()
            writer = csv.writer(content)
            writer.writerow([title])
            writer.writerow([f"Date range: {start} to {end}", "Demo sample rows are marked in the application database."])
            writer.writerow(headers)
            writer.writerows(rows)
            return app.response_class("\ufeff" + content.getvalue(), mimetype="text/csv", headers={"Content-Disposition": f'attachment; filename="{report_type}-{start}-to-{end}.csv"'})
        output = BytesIO()
        if export_format == "xlsx":
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = title[:31]
            sheet.append([title])
            sheet.append([f"Date range: {start} to {end}"])
            sheet.append(headers)
            for row in rows:
                sheet.append(row)
            workbook.save(output)
            mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            extension = "xlsx"
        elif export_format == "pdf":
            document = SimpleDocTemplate(output, pagesize=landscape(letter), title=title)
            styles = getSampleStyleSheet()
            data = [[title], [f"Date range: {start} to {end}"], headers, *[[str(value or "") for value in row] for row in rows]]
            table = Table(data, repeatRows=3)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#10284d")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#e9effb")),
                ("GRID", (0, 2), (-1, -1), .3, colors.HexColor("#c9d2e2")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("SPAN", (0, 0), (-1, 0)),
            ]))
            document.build([Paragraph(title, styles["Title"]), Spacer(1, 8), Paragraph(f"Date range: {start} to {end}", styles["Normal"]), Spacer(1, 10), table])
            mimetype = "application/pdf"
            extension = "pdf"
        else:
            return api_error("Format must be csv, xlsx, or pdf.")
        output.seek(0)
        return send_file(output, mimetype=mimetype, as_attachment=True, download_name=f"{report_type}-{start}-to-{end}.{extension}")
    except ValueError as error:
        return api_error(str(error))


@app.get("/api/menu")
@require_roles("Admin", "Manager", "Inspector", "Student")
def get_menu():
    with get_db() as connection:
        rows = connection.execute(
            "SELECT id, menu_date, meal, name, description, price FROM menu_items WHERE menu_date = date('now') AND available = 1 ORDER BY CASE meal WHEN 'Breakfast' THEN 1 WHEN 'Lunch' THEN 2 WHEN 'Snacks' THEN 3 ELSE 4 END, name"
        ).fetchall()
    return jsonify(items=[dict(row) for row in rows])


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify(error="Request is too large."), 413


@app.errorhandler(403)
def forbidden(_error):
    return jsonify(error="You do not have permission to access this page."), 403


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")), debug=os.environ.get("FLASK_DEBUG") == "1")
