import json
import os
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from socket import socket
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from unittest import TestCase
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import ProxyHandler, Request, build_opener


APP_ROOT = Path(__file__).resolve().parents[2]
CONTACT_CENTER = "/api/v1/contact-center"
VOICE = "/api/v1/voice"
OPERATOR = "test-operator-1"
OTHER_OPERATOR = "test-operator-2"
CONNECTION_OPERATOR = "test-operator-3"
VOICE_TOKEN = "test-voice-worker"
KNOWLEDGE_TOKEN = "test-knowledge-reader"
KNOWLEDGE = "/api/v1/knowledge/articles"
VOICE_KNOWLEDGE = VOICE + "/knowledge"
DEPARTMENT = "technical_support"


SERVER_SCRIPT = """
import sys
from threading import Thread
from uvicorn import Config, Server

server = Server(Config('app.main:app', host='127.0.0.1', port=int(sys.argv[1])))

def stop_on_eof():
    sys.stdin.read()
    server.should_exit = True

Thread(target=stop_on_eof, daemon=True).start()
server.run()
"""


class ContactCenterTest(TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(TemporaryDirectory()))
        self.database = self.directory / "contact-center.sqlite3"
        self.env = {
            **os.environ,
            "DATABASE_PATH": str(self.database),
            "PYTHONPATH": str(APP_ROOT / "backend"),
            "IRIS_CONTACT_CENTER": "1",
            "IRIS_DEMO": "1",
            "IRIS_OPERATOR_TOKENS": json.dumps({
                OPERATOR: "operator_1", OTHER_OPERATOR: "operator_2", CONNECTION_OPERATOR: "operator_3",
            }),
            "IRIS_VOICE_TOKEN": VOICE_TOKEN,
            "IRIS_VOICE_KNOWLEDGE_TOKEN": KNOWLEDGE_TOKEN,
            "IRIS_ASSIGNMENT_TIMEOUT_SECONDS": "15",
            "IRIS_CONNECTION_TIMEOUT_SECONDS": "15",
        }
        setup = subprocess.run(
            [sys.executable, "-m", "app.core.contact_center.initialize"], cwd=APP_ROOT, env=self.env,
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
        )
        self.assertEqual(setup.returncode, 0, setup.stdout + setup.stderr)
        self.process = None
        self.addCleanup(self.stop_api)
        self.start_api()

    def start_api(self):
        with socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.base_url = f"http://127.0.0.1:{port}"
        self.log_file = self.directory / "api.log"
        with self.log_file.open("wb") as log:
            self.process = subprocess.Popen(
                [sys.executable, "-c", SERVER_SCRIPT, str(port)], cwd=APP_ROOT, env=self.env,
                stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT,
            )
        deadline = monotonic() + 12
        while self.process.poll() is None and monotonic() < deadline:
            try:
                self.request("GET", "/health")
            except URLError:
                sleep(0.05)
            else:
                return
        self.fail(self.log_file.read_text(encoding="utf-8", errors="replace"))

    def stop_api(self):
        if self.process is None:
            return
        process, self.process = self.process, None
        # EOF reaches the interpreter on Windows even when python.exe starts through a venv launcher.
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def open_request(self, path, *, method="GET", token=None, payload=None, headers=None):
        headers = dict(headers or {})
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        request = Request(self.base_url + path, method=method, headers=headers, data=data)
        return build_opener(ProxyHandler({})).open(request, timeout=5)

    def request(self, method, path, *, token=None, payload=None, expected=200, headers=None):
        try:
            response = self.open_request(path, method=method, token=token, payload=payload, headers=headers)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            if response.code != expected:
                diagnosis = f"{method} {path}: {body.decode('utf-8')}"
                if response.code >= 500:
                    lines = self.log_file.read_text(encoding="utf-8", errors="replace").splitlines()
                    diagnosis += "\n" + "\n".join(lines[-60:])
                self.assertEqual(response.code, expected, diagnosis)
            return json.loads(body) if body else None

    def operator(self, method, path, *, token=OPERATOR, **kwargs):
        return self.request(method, CONTACT_CENTER + path, token=token, **kwargs)

    def voice(self, method, path, *, token=VOICE_TOKEN, **kwargs):
        return self.request(method, VOICE + path, token=token, **kwargs)

    def browser_session(self, role):
        with self.open_request("/api/v1/auth/login", method="POST", payload={
            "username": role, "password": f"iris-{role}",
        }) as response:
            self.assertEqual(json.load(response)["role"], role)
            return {"Cookie": response.headers["Set-Cookie"].split(";", 1)[0]}

    def start_call(self, provider_id):
        call = self.voice("POST", "/calls", payload={"provider_call_id": provider_id})
        call_path = "/calls/" + call["id"]
        self.assertEqual(self.voice("POST", call_path + "/connected")["phase"], "ai_active")
        return call, call_path

    def handoff(self, call_path, **kwargs):
        return self.voice("POST", call_path + "/handoff", payload={
            "event_id": "handoff", "department": DEPARTMENT, **kwargs,
        })

    def move_second_operator(self):
        with closing(sqlite3.connect(self.database, timeout=5)) as db, db:
            db.execute("UPDATE employees SET department = ?, updated_at = ? WHERE id = ?", (
                DEPARTMENT, "2026-11-27 10:00:00", "operator_2",
            ))
        self.operator("PATCH", "/profile/status", token=OTHER_OPERATOR, payload={"status": "available"})

    def accept(self, assignment, *, token=OPERATOR, expected=200):
        return self.operator("POST", f"/assignments/{assignment['id']}/accept", token=token, expected=expected)

    def finish(self, call_path, status="completed", outcome="unresolved"):
        return self.voice("POST", call_path + "/finish", payload={"status": status, "outcome": outcome})

    def test_knowledge_publication_lifecycle(self):
        manager = self.browser_session("manager")
        article = self.request("POST", KNOWLEDGE, headers=manager, expected=201, payload={
            "title": "Подключение роутера", "category": "instructions", "body": "Включите роутер в розетку.",
        })
        article_path = KNOWLEDGE + "/" + article["id"]
        public_path = VOICE_KNOWLEDGE + "/articles/" + article["id"]
        search = VOICE_KNOWLEDGE + "/search?q=" + quote("РОУТЕР розётку")
        self.assertEqual(article["status"], "draft")
        self.assertEqual(self.request("GET", search, token=KNOWLEDGE_TOKEN)["items"], [])
        self.request("GET", public_path, token=KNOWLEDGE_TOKEN, expected=404)

        published = self.request("POST", article_path + "/publish", headers=manager, payload={"version": article["version"]})
        self.assertEqual(self.request("GET", search + "&category=instructions", token=KNOWLEDGE_TOKEN)["items"][0]["id"], article["id"])
        self.assertEqual(self.request("GET", search + "&category=faq", token=KNOWLEDGE_TOKEN)["items"], [])
        updated = self.request("PUT", article_path, headers=manager, payload={
            "title": "Настройка Wi-Fi", "category": "faq", "body": "Используйте данные с наклейки.", "version": published["version"],
        })
        self.assertTrue(updated["has_unpublished_changes"])
        self.request("POST", article_path + "/archive", headers=manager, payload={"version": published["version"]}, expected=409)
        manager_search = self.request("GET", KNOWLEDGE + "?q=Wi-Fi&status=published&category=faq", headers=manager)
        self.assertEqual(manager_search["items"][0]["title"], updated["title"])
        with self.open_request(public_path, token=KNOWLEDGE_TOKEN) as response:
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(json.load(response)["body"], article["body"])
        self.assertEqual(self.request("GET", search, token=KNOWLEDGE_TOKEN)["items"][0]["title"], article["title"])
        self.assertEqual(self.request("GET", VOICE_KNOWLEDGE + "/search?q=Wi-Fi", token=KNOWLEDGE_TOKEN)["items"], [])

        republished = self.request("POST", article_path + "/publish", headers=manager, payload={"version": updated["version"]})
        self.assertEqual(self.request("GET", public_path, token=KNOWLEDGE_TOKEN)["body"], updated["body"])
        self.request("POST", article_path + "/archive", headers=manager, payload={"version": republished["version"]})
        self.assertEqual(self.request("GET", VOICE_KNOWLEDGE + "/search?q=Wi-Fi", token=KNOWLEDGE_TOKEN)["items"], [])
        self.request("GET", public_path, token=KNOWLEDGE_TOKEN, expected=404)
        self.stop_api()
        self.start_api()
        self.assertEqual(self.request("GET", article_path, headers=manager)["status"], "archived")

    def test_knowledge_separates_browser_and_service_access(self):
        manager = self.browser_session("manager")
        operator = self.browser_session("operator")
        search = VOICE_KNOWLEDGE + "/search?q=tariff"
        self.request("GET", KNOWLEDGE, expected=401)
        self.request("GET", KNOWLEDGE, headers=operator, expected=403)
        self.request("POST", KNOWLEDGE, headers={**manager, "Origin": "https://other.example"}, payload={}, expected=403)
        self.request("POST", KNOWLEDGE, headers=manager, payload={"title": " ", "body": "Text", "category": "faq"}, expected=422)
        self.request("GET", search, headers=manager, expected=401)
        for token in (VOICE_TOKEN, OPERATOR):
            self.request("GET", search, token=token, expected=401)
        self.request("GET", KNOWLEDGE, token=KNOWLEDGE_TOKEN, expected=401)
        self.voice("POST", "/calls", token=KNOWLEDGE_TOKEN, payload={}, expected=401)
        self.request("GET", search + "&limit=21", token=KNOWLEDGE_TOKEN, expected=422)
        self.stop_api()
        self.env["IRIS_CONTACT_CENTER"] = "0"
        self.start_api()
        self.request("GET", search, token=KNOWLEDGE_TOKEN)
        self.stop_api()
        self.env.pop("IRIS_VOICE_KNOWLEDGE_TOKEN")
        self.start_api()
        self.request("GET", search, token=KNOWLEDGE_TOKEN, expected=503)

    def test_voice_and_operator_lifecycle_with_crm_and_case(self):
        self.operator("GET", "/workspace", token=None, expected=401)
        self.operator("GET", "/workspace", token=None, headers={"Authorization": "Basic wrong"}, expected=401)
        self.operator("GET", "/workspace", token=VOICE_TOKEN, expected=401)
        self.voice("POST", "/calls", token=OPERATOR, payload={"provider_call_id": "rejected"}, expected=401)

        call, path = self.start_call("provider/lifecycle")
        repeated = self.voice("POST", "/calls", payload={"provider_call_id": "provider/lifecycle"})
        self.assertEqual(repeated["id"], call["id"])
        self.voice("GET", path + "/account", expected=409)
        self.assertTrue(self.voice("POST", path + "/identify", payload={
            "account_id": "100042", "apartment": "42",
        })["identified"])
        account = self.voice("GET", path + "/account")
        self.assertEqual(account["number"], "100042")
        self.assertEqual(account["active_incidents"][0]["id"], "NET-102")

        message_input = {"event_id": "consent", "speaker": "customer", "text": "Да, передайте в поддержку."}
        message = self.voice("POST", path + "/messages", payload=message_input)
        self.assertEqual(self.voice("POST", path + "/messages", payload=message_input), message)
        self.voice("POST", path + "/messages", payload={**message_input, "text": "Нет."}, expected=409)
        summary_input = {"event_id": "summary", "summary": "Связь пропала после зачисления платежа."}
        self.assertEqual(self.voice("POST", path + "/summary", payload=summary_input)["summary"], summary_input["summary"])
        self.voice("POST", path + "/summary", payload=summary_input)
        self.handoff(path, priority="high")
        offer = self.voice("GET", path + "/assignment")
        self.assertEqual((offer["employee_id"], offer["state"]), ("operator_1", "offered"))
        self.handoff(path, priority="high")
        self.assertEqual(self.operator("GET", "/workspace")["assignment"]["id"], offer["id"])

        self.accept(offer, token=OTHER_OPERATOR, expected=404)
        self.operator("GET", path, token=OTHER_OPERATOR, expected=404)
        self.operator("GET", path + "/account", token=OTHER_OPERATOR, expected=404)
        self.voice("POST", path + f"/assignments/{offer['id']}/connected", expected=409)
        self.assertEqual(self.accept(offer)["state"], "accepted")
        self.assertEqual(self.operator("GET", path)["phase"], "operator_joining")
        self.assertEqual(self.operator("GET", path + "/account"), account)
        self.assertEqual(self.operator("GET", "/dashboard")["active_incidents"][0]["id"], "NET-102")

        commands = self.voice("GET", path + "/commands")
        self.assertEqual([command["kind"] for command in commands], ["connect"])
        command_path = path + f"/commands/{commands[0]['id']}/ack"
        ack = self.voice("POST", command_path)
        self.assertIsNotNone(ack["acknowledged_at"])
        self.assertEqual(self.voice("POST", command_path), ack)
        self.assertEqual(self.voice("GET", path + "/commands"), [])

        audio_path = path + f"/assignments/{offer['id']}/connected"
        connected = self.voice("POST", audio_path)
        self.assertEqual(connected["state"], "connected")
        self.assertEqual(self.voice("POST", audio_path), connected)
        self.assertEqual(self.operator("GET", path)["phase"], "with_operator")
        handoff = {
            "ticket_id": "T-CC-INTEGRATION", "customer_request": "Восстановить связь",
            "summary": summary_input["summary"], "customer_report": "Связь пропала после платежа.",
            "verified_facts": [], "open_question": "Когда восстановится связь?", "secondary_questions": [],
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
        }
        ticket_input = {"handoff": handoff, "confirmation_message_id": message["id"],
                        "department": DEPARTMENT, "account_number": "100042"}
        ticket = self.voice("POST", path + "/ticket", payload=ticket_input)
        self.assertEqual(self.voice("POST", path + "/ticket", payload=ticket_input)["id"], ticket["id"])
        ended = self.finish(path)
        self.assertEqual((ended["status"], ended["phase"], ended["outcome"]), ("completed", None, "ticket_created"))
        self.assertEqual(self.finish(path, "failed"), ended)
        ticket_path = "/cases/" + ticket["id"]
        saved_case = self.operator("GET", ticket_path)
        self.assertEqual((saved_case["summary"], saved_case["status"]), (summary_input["summary"], "queued"))
        browser_case_path = "/api/v1/operator/tickets/" + ticket["id"]
        browser = self.browser_session("operator")
        case_context = self.request("GET", browser_case_path, headers=browser)
        self.assertEqual(case_context["ticket"]["id"], ticket["id"])
        self.assertEqual(case_context["handoff"]["summary"], summary_input["summary"])
        self.assertEqual(case_context["call_outcome"], "ticket_created")
        self.assertEqual(case_context["events"], self.operator("GET", ticket_path + "/events"))
        self.request("GET", "/api/v1/operator/tickets/T-1043", expected=404, headers=browser)
        self.operator("GET", ticket_path, token=OTHER_OPERATOR, expected=404)
        case_update = {"status": "in_progress"}
        self.operator("PATCH", ticket_path, token=OTHER_OPERATOR, payload=case_update, expected=404)
        updated_case = self.operator("PATCH", ticket_path, payload=case_update)
        self.assertEqual((updated_case["status"], updated_case["assigned_employee_id"]), ("in_progress", "operator_1"))
        self.assertEqual(self.operator("GET", "/profile")["status"], "wrap_up")
        self.operator("POST", "/profile/complete-wrap-up")
        self.assertEqual(self.operator("GET", "/profile")["status"], "available")
        self.assertEqual(self.request("POST", "/api/v1/operator/profile/complete-wrap-up", headers=browser)["status"], "available")

        customer_path = "/api/v1/customers/customer_100042"
        self.request("GET", customer_path, expected=401)
        self.request("GET", "/api/v1" + path, expected=401)
        self.request("GET", "/api/v1/events", expected=401)
        manager = self.browser_session("manager")
        before_restart = self.request("GET", customer_path, headers=manager)
        self.stop_api()
        self.env["IRIS_CONTACT_CENTER"] = "0"
        self.start_api()
        legacy_customer = self.request("GET", customer_path, headers=manager)
        self.assertEqual(legacy_customer, before_restart)
        self.assertEqual(next(item for item in legacy_customer["accounts"] if item["number"] == "100042"), account)
        browser = self.browser_session("operator")
        self.assertFalse(self.request("GET", "/api/v1/operator/workspace", headers=browser)["voice_available"])
        accept_path = f"/api/v1/operator/assignments/{offer['id']}/accept"
        self.request("POST", accept_path, expected=401)
        self.request("POST", accept_path, expected=503, headers=browser)

    def test_browser_operator_uses_session_scoped_core(self):
        browser = "/api/v1/operator"
        self.request("GET", browser + "/workspace", expected=401)
        manager = self.browser_session("manager")
        self.request("GET", browser + "/workspace", expected=403, headers=manager)
        headers = self.browser_session("operator")

        call, path = self.start_call("provider/browser-scope")
        customer_path = browser + "/customers/customer_100046"
        self.assertTrue(self.voice("POST", path + "/identify", payload={
            "account_id": "100047", "apartment": "304",
        })["identified"])
        self.handoff(path)
        workspace = self.request("GET", browser + "/workspace", headers=headers)
        self.assertTrue(workspace["voice_available"])
        self.assertEqual([item["id"] for item in workspace["calls"]], [call["id"]])
        detail_path = browser + path
        self.request("GET", detail_path, expected=404, headers=headers)
        self.request("GET", customer_path, expected=404, headers=headers)
        assignment = workspace["assignment"]
        joined = self.request("POST", browser + f"/assignments/{assignment['id']}/accept", headers=headers)
        self.assertEqual(joined["state"], "accepted")
        customer = self.request("GET", customer_path, headers=headers)
        self.assertEqual([item["number"] for item in customer["accounts"]], ["100047"])
        self.request("GET", browser + "/customers/customer_100042", expected=404, headers=headers)
        self.request("GET", "/api/v1/customers/customer_100046", expected=403, headers=headers)

        data = {"event_id": "browser-note", "text": "Проверить оборудование"}
        note = self.request("POST", detail_path + "/notes", payload=data, headers=headers, expected=201)
        repeated = self.request("POST", detail_path + "/notes", payload=data, headers=headers, expected=201)
        self.assertEqual(repeated, note)
        detail = self.request("GET", detail_path, headers=headers)
        self.assertEqual(detail["notes"], [note])
        self.assertNotIn("call.operator_note", [event["type"] for event in detail["events"]])
        self.assertEqual(self.request("GET", browser + "/analytics", headers=headers)["accepted_calls"], 1)
        self.request("PATCH", browser + "/status", payload={"status": "paused"}, expected=409, headers=headers)
        with self.open_request(browser + "/events", headers=headers) as stream:
            self.assertEqual(stream.readline().strip(), b"retry: 2000")
            self.assertEqual(stream.readline().strip(), b"")
            self.request("POST", "/api/v1/auth/logout", expected=204, headers=headers)
            self.assertEqual(stream.readline(), b"")
        self.request("GET", detail_path, expected=401, headers=headers)

    def test_manager_snapshot_reads_live_queue_and_assignments(self):
        snapshot_path = "/api/v1/manager/contact-center"
        self.request("GET", snapshot_path, expected=401)
        self.request("GET", snapshot_path, expected=403, headers=self.browser_session("operator"))
        manager = self.browser_session("manager")
        self.assertEqual(self.request("GET", snapshot_path, headers=manager)["total"], 0)

        assigned, assigned_path = self.start_call("provider/manager-offer")
        waiting, waiting_path = self.start_call("provider/manager-waiting")
        self.handoff(assigned_path)
        self.handoff(waiting_path, priority="high")
        data = self.request("GET", snapshot_path + "?limit=1", headers=manager)
        self.assertEqual(data["total"], 2)
        self.assertIn({"code": DEPARTMENT, "name": "Техническая поддержка"}, data["departments"])
        self.assertEqual([row["call_id"] for row in data["items"]], [waiting["id"]])
        self.assertIsNone(data["items"][0]["assignment"])

        offered_url = snapshot_path + f"?department={DEPARTMENT}&state=offered"
        offered, = self.request("GET", offered_url, headers=manager)["items"]
        self.assertEqual(offered["call_id"], assigned["id"])
        self.assertEqual(offered["assignment"]["employee_id"], "operator_1")
        self.assertEqual(offered["assignment"]["state"], "offered")
        self.assertNotIn("customer_id", offered)
        self.assertEqual(self.request("GET", offered_url + "&offset=1", headers=manager)["items"], [])
        self.request("GET", snapshot_path + "?state=closed", expected=422, headers=manager)

        self.accept(offered["assignment"])
        connecting, = self.request("GET", snapshot_path + "?state=connecting", headers=manager)["items"]
        self.assertEqual(connecting["assignment"]["state"], "accepted")
        employee_path = "/api/v1/employees/operator_1"
        self.request("PATCH", employee_path, payload={"status": "paused"}, expected=409, headers=manager)
        self.voice("POST", assigned_path + f"/assignments/{connecting['assignment']['id']}/connected")
        self.finish(assigned_path)
        team = self.request("GET", "/api/v1/employees", headers=manager)
        self.assertEqual(next(item for item in team if item["id"] == "operator_1")["status"], "wrap_up")
        self.assertEqual(self.request("GET", snapshot_path, headers=manager)["total"], 1)

    def test_manager_analytics_uses_period_department_and_assignment(self):
        route = "/api/v1/manager/analytics?from_date=2030-01-01&to_date=2030-01-02"
        self.request("GET", route, expected=401)
        self.request("GET", route, expected=403, headers=self.browser_session("operator"))
        manager = self.browser_session("manager")
        with closing(sqlite3.connect(self.database, timeout=5)) as db, db:
            db.execute("INSERT INTO cc_departments (code,name,enabled) VALUES ('test_l2','Линия 2',1)")
            db.executemany("""
                INSERT INTO calls (id,department,status,outcome,started_at,connected_at,ended_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [
                ("report-handled", "test_l2", "completed", "answered", "2030-01-01 20:59:00", "2030-01-01 20:59:10", "2030-01-01 21:00:10"),
                ("report-abandoned", "test_l2", "abandoned", "unresolved", "2030-01-01 21:03:00", None, "2030-01-01 21:03:15"),
            ])
            db.execute("""
                INSERT INTO cc_live_queue (call_id,department,priority,required_skills,state,queued_at)
                VALUES ('report-handled','test_l2','normal','[]','closed','2030-01-01 20:59:12')
            """)
            db.execute("""
                INSERT INTO cc_assignments (id,call_id,employee_id,state,offered_at,accepted_at,connected_at,ended_at)
                VALUES ('report-assignment','report-handled','operator_1','ended',
                        '2030-01-01 20:59:14','2030-01-01 20:59:20','2030-01-01 20:59:30','2030-01-01 21:00:10')
            """)
            db.execute("""
                INSERT INTO tickets (id,call_id,department,status,priority,title,summary,created_at,queued_at,started_at,
                                     closed_at,assigned_employee_id)
                VALUES ('T-report','report-handled','test_l2','closed','normal','Проверка','Проверка',
                        '2030-01-01 20:59:30','2030-01-01 20:59:30','2030-01-01 21:00:00','2030-01-01 21:01:00','operator_2')
            """)

        report = self.request("GET", route + "&department=test_l2", headers=manager)
        self.assertEqual([report[key] for key in (
            "total_calls", "accepted_calls", "abandoned_calls", "total_tickets", "resolved_tickets",
            "average_answer_seconds", "average_duration_seconds", "average_wait_seconds",
        )], [2, 1, 1, 1, 1, 10, 60, 30])
        self.assertEqual([(item["total_calls"], item["total_tickets"], item["resolved_tickets"])
                          for item in report["daily"]], [(1, 1, 0), (1, 0, 1)])
        self.assertEqual(report["by_department"][0]["name"], "Линия 2")
        self.assertEqual(report["outcomes"], [{"outcome": "answered", "count": 1}, {"outcome": "unresolved", "count": 1}])

        employee_report = self.request("GET", route + "&employee_id=operator_1", headers=manager)
        self.assertEqual(employee_report["total_calls"], 1)
        self.assertEqual(employee_report["average_answer_seconds"], 20)
        self.assertEqual(employee_report["average_duration_seconds"], 40)
        self.assertEqual(employee_report["resolved_tickets"], 0)
        self.assertEqual(self.request("GET", route + "&employee_id=operator_2", headers=manager)["resolved_tickets"], 1)
        self.request("GET", "/api/v1/manager/analytics?from_date=2030-01-02&to_date=2030-01-01", expected=422, headers=manager)

    def test_abandoned_call_case_is_claimable_and_settings_are_personal(self):
        self.move_second_operator()
        _, path = self.start_call("provider/case-queue")
        message = self.voice("POST", path + "/messages", payload={
            "event_id": "consent", "speaker": "customer", "text": "Да, создайте обращение.",
        })
        ticket_id = "T-CC-DROPPED"
        recorded = self.voice("POST", path + "/ticket", payload={
            "confirmation_message_id": message["id"], "department": DEPARTMENT,
            "handoff": {
                "ticket_id": ticket_id, "customer_request": "Нет интернета", "summary": "Нужна диагностика.",
                "customer_report": "Роутер не видит сеть.", "verified_facts": [],
                "assumptions": ["Возможна проблема с оборудованием"], "actions_taken": ["Уточнили признаки"],
                "open_question": "Горит ли индикатор?", "secondary_questions": [], "confirmed_at": message["created_at"],
            },
        })
        case_path = "/cases/" + ticket_id
        self.assertEqual(recorded["status"], "queued")
        self.operator("POST", case_path + "/claim", expected=404)
        self.finish(path, "abandoned")
        entry, = [case for case in self.operator("GET", "/cases/queue") if case["id"] == ticket_id]
        self.assertEqual(set(entry), {"id", "department", "priority", "queued_at"})
        self.operator("POST", case_path + "/claim", token=CONNECTION_OPERATOR, expected=404)

        def claim(token):
            try:
                with self.open_request(CONTACT_CENTER + case_path + "/claim", method="POST", token=token) as response:
                    return response.code, token
            except HTTPError as error:
                with error:
                    return error.code, token

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = sorted(executor.map(claim, (OPERATOR, OTHER_OPERATOR)))
        self.assertEqual([code for code, _ in results], [200, 404])
        claimed = self.operator("POST", case_path + "/claim", token=results[0][1])
        self.assertEqual(claimed["status"], "in_progress")
        context = self.operator("GET", case_path + "/context", token=results[0][1])
        self.assertEqual(context["call_outcome"], "ticket_created")
        self.assertEqual(context["handoff"]["assumptions"], ["Возможна проблема с оборудованием"])
        self.assertEqual(context["handoff"]["actions_taken"], ["Уточнили признаки"])
        self.operator("GET", case_path + "/context", token=results[1][1], expected=404)
        self.operator("GET", path, token=results[0][1], expected=404)

        self.assertTrue(self.operator("GET", "/profile/settings")["notifications_enabled"])
        settings = {"notifications_enabled": False, "sound_enabled": False}
        self.assertEqual(self.operator("PUT", "/profile/settings", payload=settings), settings)
        self.assertTrue(self.operator("GET", "/profile/settings", token=OTHER_OPERATOR)["sound_enabled"])
        self.stop_api()
        self.start_api()
        self.assertEqual(self.operator("GET", "/profile/settings"), settings)

    def test_concurrent_calls_and_accepts_reserve_one_operator(self):
        first_call, first_path = self.start_call("provider/concurrent-a")
        second_call, second_path = self.start_call("provider/concurrent-b")
        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(self.handoff, (first_path, second_path)))
        assignments = [self.voice("GET", path + "/assignment") for path in (first_path, second_path)]
        offered, = [assignment for assignment in assignments if assignment is not None]
        self.assertEqual(offered["employee_id"], "operator_1")
        waiting_call_id, = {first_call["id"], second_call["id"]} - {offered["call_id"]}
        queue = self.operator("GET", "/queue")
        self.assertEqual([(row["call_id"], row["state"]) for row in queue], [(waiting_call_id, "waiting")])

        with ThreadPoolExecutor(max_workers=2) as executor:
            accepted = list(executor.map(self.accept, (offered, offered)))
        self.assertEqual([item["state"] for item in accepted], ["accepted", "accepted"])
        self.assertEqual(accepted[0], accepted[1])
        commands = self.voice("GET", f"/calls/{offered['call_id']}/commands")
        self.assertEqual([command["kind"] for command in commands], ["connect"])

    def test_paused_operator_and_abandoned_queue_entry(self):
        self.operator("PATCH", "/profile/status", payload={"status": "paused"})
        call, path = self.start_call("provider/disconnected")
        self.assertEqual(self.handoff(path)["state"], "waiting")
        self.assertIsNone(self.voice("GET", path + "/assignment"))
        queue = self.operator("GET", "/queue")
        self.assertEqual([(item["call_id"], item["position"]) for item in queue], [(call["id"], 1)])
        self.finish(path, "abandoned")
        self.operator("PATCH", "/profile/status", payload={"status": "available"})
        self.assertEqual(self.operator("GET", "/queue"), [])
        self.assertIsNone(self.voice("GET", path + "/assignment"))

    def test_offer_expires_and_late_accept_cannot_claim_reassignment(self):
        self.stop_api()
        self.env["IRIS_ASSIGNMENT_TIMEOUT_SECONDS"] = "2"
        self.start_api()
        self.move_second_operator()
        _, path = self.start_call("provider/expiry")
        self.handoff(path)
        first = self.voice("GET", path + "/assignment")
        self.assertEqual(first["employee_id"], "operator_1")

        deadline = monotonic() + 8
        while monotonic() < deadline:
            replacement = self.voice("GET", path + "/assignment")
            if replacement and replacement["id"] != first["id"]:
                break
            sleep(0.1)
        else:
            self.fail("Expired offer was not reassigned")
        self.assertEqual(replacement["employee_id"], "operator_2")
        self.accept(first, expected=409)
        self.assertEqual(self.accept(replacement, token=OTHER_OPERATOR)["state"], "accepted")

    def test_failed_voice_connection_requeues_and_rejects_late_audio(self):
        self.move_second_operator()
        _, path = self.start_call("provider/audio-failure")
        self.handoff(path)
        assigned = self.voice("GET", path + "/assignment")
        self.assertEqual(assigned["employee_id"], "operator_1")
        self.accept(assigned)
        assignment_path = f"{path}/assignments/{assigned['id']}"
        failure = self.voice("POST", assignment_path + "/failed")
        self.assertEqual(failure["state"], "failed")
        self.assertEqual(self.voice("POST", assignment_path + "/failed"), failure)
        self.assertEqual(self.operator("GET", "/profile")["status"], "available")
        replacement = self.voice("GET", path + "/assignment")
        self.assertEqual((replacement["employee_id"], replacement["state"]), ("operator_2", "offered"))
        self.voice("POST", assignment_path + "/connected", expected=409)

    def test_connection_timeout_releases_employee_and_invalidates_connect_command(self):
        self.stop_api()
        self.env["IRIS_CONNECTION_TIMEOUT_SECONDS"] = "2"
        self.start_api()
        _, path = self.start_call("provider/connection-timeout")
        self.handoff(path)
        offer = self.voice("GET", path + "/assignment")
        self.accept(offer)
        command, = self.voice("GET", path + "/commands")

        deadline = monotonic() + 8
        while monotonic() < deadline:
            if self.voice("GET", path + "/assignment") is None:
                break
            sleep(0.1)
        else:
            self.fail("Unconfirmed audio reservation did not expire")
        self.assertEqual(self.operator("GET", "/profile")["status"], "available")
        self.assertEqual([item["kind"] for item in self.voice("GET", path + "/commands")], ["cancel_connect"])
        self.voice("POST", path + f"/commands/{command['id']}/ack", expected=409)
        self.voice("POST", path + f"/assignments/{offer['id']}/connected", expected=409)

    def test_routing_uses_priority_skill_shift_and_longest_available(self):
        self.operator("PATCH", "/profile/status", payload={"status": "paused"})
        self.move_second_operator()
        with closing(sqlite3.connect(self.database, timeout=5)) as db, db:
            db.execute("UPDATE cc_workforce SET on_shift = 0 WHERE employee_id = ?", ("operator_2",))
            db.execute("INSERT INTO cc_routing_rules (category, department, required_skills) VALUES (?, ?, ?)", (
                "fiber", DEPARTMENT, json.dumps(["fiber_test"]),
            ))

        low, low_path = self.start_call("provider/priority-low")
        self.assertEqual(self.handoff(low_path, priority="low")["state"], "waiting")
        high, high_path = self.start_call("provider/priority-high")
        high_request = self.handoff(high_path, category="fiber", department=None, priority="high")
        self.assertEqual((high_request["department"], high_request["required_skills"]), (DEPARTMENT, ["fiber_test"]))
        self.assertEqual([(item["call_id"], item["position"]) for item in self.operator("GET", "/queue")], [
            (high["id"], 1), (low["id"], 2),
        ])
        self.assertIsNone(self.voice("GET", high_path + "/assignment"))
        self.assertIsNone(self.voice("GET", low_path + "/assignment"))

        self.operator("PATCH", "/profile/status", payload={"status": "available"})
        self.assertEqual(self.voice("GET", low_path + "/assignment")["employee_id"], "operator_1")
        self.assertIsNone(self.voice("GET", high_path + "/assignment"))
        with closing(sqlite3.connect(self.database, timeout=5)) as db, db:
            db.execute("UPDATE cc_workforce SET skills = ?, on_shift = 1 WHERE employee_id = ?", (
                json.dumps(["fiber_test"]), "operator_2",
            ))
        self.operator("GET", "/workspace", token=OTHER_OPERATOR)
        self.assertEqual(self.voice("GET", high_path + "/assignment")["employee_id"], "operator_2")

        self.finish(high_path, "abandoned")
        self.finish(low_path, "abandoned")
        with closing(sqlite3.connect(self.database, timeout=5)) as db, db:
            db.execute("UPDATE cc_workforce SET available_since = ? WHERE employee_id = ?", (
                "2026-11-26 10:00:00", "operator_2",
            ))
        _, third_path = self.start_call("provider/longest-available")
        self.handoff(third_path)
        self.assertEqual(self.voice("GET", third_path + "/assignment")["employee_id"], "operator_2")

    def test_transfer_to_department_and_employee_waits_for_voice_ack(self):
        call, path = self.start_call("provider/transfer")
        self.handoff(path)
        original = self.voice("GET", path + "/assignment")
        self.accept(original)
        self.voice("POST", path + f"/assignments/{original['id']}/connected")
        command_path = f"/assignments/{original['id']}/control"
        transfer = {"event_id": "transfer-1", "action": "transfer", "department": "connection"}
        self.operator("POST", command_path, token=CONNECTION_OPERATOR, payload=transfer, expected=404)
        command = self.operator("POST", command_path, payload=transfer)
        self.assertEqual(command["kind"], "transfer")
        self.assertEqual(self.operator("POST", command_path, payload=transfer), command)
        self.assertEqual(self.voice("GET", path + "/assignment")["id"], original["id"])
        self.assertIsNone(self.operator("GET", "/workspace", token=CONNECTION_OPERATOR)["assignment"])

        ack_path = path + f"/commands/{command['id']}/ack"
        ack = self.voice("POST", ack_path)
        self.assertEqual(self.voice("POST", ack_path), ack)
        replacement = self.voice("GET", path + "/assignment")
        self.assertEqual((replacement["employee_id"], replacement["state"]), ("operator_3", "offered"))
        self.assertEqual(self.operator("GET", "/profile")["status"], "wrap_up")
        self.accept(replacement, token=CONNECTION_OPERATOR)
        self.assertEqual(self.operator("GET", path, token=CONNECTION_OPERATOR)["phase"], "operator_joining")
        connected = self.voice("POST", path + f"/assignments/{replacement['id']}/connected")
        self.assertEqual((connected["call_id"], connected["state"]), (call["id"], "connected"))

        self.move_second_operator()
        second_control = f"/assignments/{replacement['id']}/control"
        to_employee = {"event_id": "transfer-2", "action": "transfer", "target_employee_id": "operator_2"}
        targeted = self.operator("POST", second_control, token=CONNECTION_OPERATOR, payload=to_employee)
        self.assertEqual(targeted["payload"]["target_employee_id"], "operator_2")
        self.assertEqual(self.voice("GET", path + "/assignment")["id"], replacement["id"])
        self.voice("POST", path + f"/commands/{targeted['id']}/ack")
        employee_offer = self.voice("GET", path + "/assignment")
        self.assertEqual((employee_offer["employee_id"], employee_offer["state"]), ("operator_2", "offered"))
        self.assertEqual(self.accept(employee_offer, token=OTHER_OPERATOR)["state"], "accepted")

    def test_restart_preserves_assignment_transcript_commands_and_sse_cursor(self):
        call, path = self.start_call("provider/restart")
        self.handoff(path)
        assignment = self.voice("GET", path + "/assignment")
        accepted = self.accept(assignment)
        commands = self.voice("GET", path + "/commands")
        with closing(sqlite3.connect(self.database, timeout=5)) as db:
            cursor = db.execute("SELECT max(id) FROM operation_events").fetchone()[0]
        transcript = self.voice("POST", path + "/messages", payload={
            "event_id": "restart-transcript", "speaker": "operator", "text": "Проверяю состояние линии.",
        })
        self.stop_api()
        self.start_api()
        self.assertEqual(self.voice("GET", path + "/assignment"), accepted)
        self.assertEqual(self.voice("GET", path + "/commands"), commands)
        self.assertIn(transcript, self.operator("GET", path)["transcript"])
        with self.open_request(CONTACT_CENTER + "/events", token=OPERATOR,
                               headers={"Last-Event-ID": str(cursor)}) as stream:
            self.assertEqual(stream.headers.get_content_type(), "text/event-stream")
            self.assertTrue(stream.readline().startswith(b"retry:"))
            self.assertEqual(stream.readline(), b"\n")
            event_id = int(stream.readline().decode("utf-8").removeprefix("id: "))
            self.assertGreater(event_id, cursor)
            self.assertEqual(stream.readline(), b"event: change\n")
            event = json.loads(stream.readline().decode("utf-8").removeprefix("data: "))
            self.assertEqual((event["type"], event["call_id"]), ("call.transcript", call["id"]))
