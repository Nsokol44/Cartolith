"""Local-only security guards (see "Local-only security" in main.py).

The backend binds 127.0.0.1, CORS is an allowlist of local origins, and
every non-GET /api request — above all POST /api/notebook/execute, which
runs arbitrary Python — requires the per-launch X-Cartolith-Token header.
These tests pin that contract so a future refactor cannot silently reopen
the hole.
"""
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)
TOKEN = {"X-Cartolith-Token": main.API_TOKEN}
CODE = {"code": "x = 40 + 2\nx"}


def test_notebook_execute_without_token_is_401():
    r = client.post("/api/notebook/execute", json=CODE)
    assert r.status_code == 401


def test_notebook_execute_with_wrong_token_is_401():
    r = client.post("/api/notebook/execute", json=CODE,
                    headers={"X-Cartolith-Token": "not-the-token"})
    assert r.status_code == 401


def test_notebook_execute_with_token_works():
    r = client.post("/api/notebook/execute", json=CODE, headers=TOKEN)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["result"] == "42"


def test_other_writes_also_require_token():
    # The guard covers every non-GET /api route, not just the notebook.
    r = client.post("/api/notebook/reset")
    assert r.status_code == 401
    r = client.post("/api/notebook/reset", headers=TOKEN)
    assert r.status_code == 200


def test_get_requests_stay_open():
    # Read-only GETs (health, status, <img> animation frames) cannot set
    # headers in every client, and CORS already blocks cross-origin reads.
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/notebook/status").status_code == 200


def test_session_token_served_to_local_origin():
    r = client.get("/api/session-token", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 200 and r.json()["token"] == main.API_TOKEN
    r = client.get("/api/session-token", headers={"Origin": "tauri://localhost"})
    assert r.status_code == 200


def test_session_token_refused_to_foreign_origin():
    r = client.get("/api/session-token", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_cors_rejects_foreign_origin():
    r = client.options(
        "/api/notebook/execute",
        headers={"Origin": "https://evil.example",
                 "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "x-cartolith-token"},
    )
    assert r.headers.get("access-control-allow-origin") != "https://evil.example"
    assert "access-control-allow-origin" not in r.headers or \
        r.headers["access-control-allow-origin"] in main._TAURI_ORIGINS


def test_cors_allows_local_dev_origin():
    r = client.options(
        "/api/notebook/execute",
        headers={"Origin": "http://localhost:5173",
                 "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "x-cartolith-token"},
    )
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
