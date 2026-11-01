from fastapi.testclient import TestClient

from app.core.config import settings


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "app": settings.APP_NAME, "version": "0.1.0"}
