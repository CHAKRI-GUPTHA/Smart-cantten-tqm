import tempfile
import unittest
from pathlib import Path

import database
import app as application


class SmartCanteenApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DATABASE_PATH = Path(self.temp_dir.name) / "test.sqlite3"
        database.initialize_database(seed=True)
        application.app.config.update(TESTING=True, SECRET_KEY="test-secret")
        self.client = application.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def login(self, username="student", password="student123"):
        response = self.client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()["user"]

    def complete_food_items(self, status_override=None):
        return [
            {"name": name, "status": (status_override or {}).get(name, "Pass"), "remarks": ""}
            for name in sorted(application.FOOD_ITEMS)
        ]

    def complete_hygiene_items(self, status_override=None):
        return [
            {"name": name, "status": (status_override or {}).get(name, "Compliant"), "remarks": ""}
            for name in sorted(application.HYGIENE_ITEMS)
        ]

    def test_feedback_submission_persists_and_requires_student(self):
        self.login()
        payload = {
            "overall_rating": 5, "food_rating": 4, "cleanliness_rating": 5,
            "service_rating": 3, "meal": "Lunch", "comments": "Fresh and tasty.",
        }
        submitted = self.client.post("/api/feedback", json=payload)
        self.assertEqual(submitted.status_code, 201, submitted.get_json())
        mine = self.client.get("/api/feedback/mine")
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(mine.get_json()["items"][0]["comments"], "Fresh and tasty.")
        self.client.post("/api/auth/logout")
        self.login("manager", "manager123")
        dashboard = self.client.get("/api/dashboard").get_json()
        self.assertEqual(dashboard["feedback_count"], 6)

    def test_inspection_scoring_and_failed_check_creates_action(self):
        self.login("inspector", "inspector123")
        food_items = self.complete_food_items({"Food freshness": "Fail"})
        response = self.client.post("/api/inspections/food", json={
            "date": "2026-10-14", "meal": "Lunch", "inspector_name": "Jordan Taylor",
            "remarks": "", "items": food_items,
        })
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertEqual(response.get_json()["score"], 86)
        self.assertEqual(response.get_json()["flagged_items"], ["Food freshness"])
        with database.get_db() as connection:
            action = connection.execute("SELECT title FROM corrective_actions ORDER BY id DESC LIMIT 1").fetchone()
        self.assertIn("Food freshness", action["title"])

        hygiene = self.client.post("/api/inspections/hygiene", json={
            "date": "2026-10-14", "inspector_name": "Jordan Taylor", "remarks": "",
            "items": self.complete_hygiene_items({"Handwashing facilities": "Non-Compliant"}),
        })
        self.assertEqual(hygiene.status_code, 201, hygiene.get_json())
        self.assertEqual(hygiene.get_json()["score"], 88)

    def test_complaint_tracking_and_student_ownership(self):
        self.login()
        created = self.client.post("/api/complaints", json={
            "category": "Taste", "description": "The rice was cold.", "meal": "Lunch",
        })
        self.assertEqual(created.status_code, 201, created.get_json())
        complaint_id = created.get_json()["id"]
        self.assertTrue(complaint_id.startswith("SC-"))
        self.assertEqual(self.client.get(f"/api/complaints/{complaint_id}").status_code, 200)
        self.client.post("/api/auth/logout")
        self.login("manager", "manager123")
        updated = self.client.patch(f"/api/complaints/{complaint_id}", json={
            "status": "Resolved", "resolution": "Meal replaced and kitchen notified.",
        })
        self.assertEqual(updated.status_code, 200, updated.get_json())
        self.assertEqual(updated.get_json()["item"]["status"], "Resolved")
        self.client.post("/api/auth/logout")
        self.client.post("/api/auth/login", json={
            "username": "admin", "password": "admin123",
        })
        self.client.post("/api/auth/users", json={
            "username": "student2", "password": "studenttwo123",
            "display_name": "Another Student", "role": "Student",
        })
        self.client.post("/api/auth/logout")
        self.login("student2", "studenttwo123")
        self.assertEqual(self.client.get(f"/api/complaints/{complaint_id}").status_code, 404)
        self.client.post("/api/auth/logout")
        self.login()
        own_ids = [item["id"] for item in self.client.get("/api/complaints/mine").get_json()["items"]]
        self.assertIn(complaint_id, own_ids)

    def test_report_generation_csv_xlsx_and_pdf(self):
        self.login("manager", "manager123")
        for report_format, expected_type in (
            ("csv", "text/csv"),
            ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("pdf", "application/pdf"),
        ):
            response = self.client.get(f"/api/reports/feedback?start=2020-01-01&end=2030-01-01&format={report_format}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, expected_type)
            self.assertGreater(len(response.data), 20)

    def test_validation_and_role_guards(self):
        self.assertEqual(self.client.post("/api/feedback", json={}).status_code, 401)
        self.login()
        invalid = self.client.post("/api/feedback", json={
            "overall_rating": 8, "food_rating": 4, "cleanliness_rating": 4,
            "service_rating": 4, "meal": "Lunch",
        })
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.client.get("/api/dashboard").status_code, 403)

    def test_deployment_health_endpoint(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})

    def test_control_limits_require_twenty_observations(self):
        self.login("manager", "manager123")
        initial = self.client.get("/api/tqm/control-chart?metric=overall_rating").get_json()
        self.assertFalse(initial["sufficient_data"])
        self.assertEqual(initial["observations"], 5)
        with database.get_db() as connection:
            connection.executemany(
                """INSERT INTO feedback
                (overall_rating, food_rating, cleanliness_rating, service_rating, meal, user_id, is_demo)
                VALUES (?, 3, 3, 3, 'Lunch', 4, 1)""",
                [(rating,) for rating in range(1, 6)] * 3,
            )
        chart = self.client.get("/api/tqm/control-chart?metric=overall_rating").get_json()
        self.assertTrue(chart["sufficient_data"])
        self.assertEqual(chart["observations"], 20)
        self.assertGreaterEqual(chart["lower_control_limit"], 1)
        self.assertLessEqual(chart["upper_control_limit"], 5)

    def test_service_time_measurements_are_validated_and_aggregated(self):
        self.login("manager", "manager123")
        first = self.client.post("/api/service-times", json={"duration_minutes": 7.5, "meal": "Lunch"})
        second = self.client.post("/api/service-times", json={"duration_minutes": 8.5, "meal": "Lunch"})
        self.assertEqual(first.status_code, 201, first.get_json())
        self.assertEqual(second.status_code, 201, second.get_json())
        dashboard = self.client.get("/api/dashboard").get_json()
        self.assertEqual(dashboard["average_service_time"], 8.0)
        self.assertEqual(dashboard["service_time_count"], 2)
        invalid = self.client.post("/api/service-times", json={"duration_minutes": 0, "meal": "Lunch"})
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(
            self.client.post("/api/service-times", json={"duration_minutes": 5, "meal": "Lunch"}).status_code,
            201,
        )
        self.client.post("/api/auth/logout")
        self.login()
        forbidden = self.client.post("/api/service-times", json={"duration_minutes": 5, "meal": "Lunch"})
        self.assertEqual(forbidden.status_code, 403)


if __name__ == "__main__":
    unittest.main()
