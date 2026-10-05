import json
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.src.models import Activity, Base, Readiness, Sleep, SleepSession
from backend.src.widget_export import SUMMARY_FILENAME, build_summary, write_summary


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def seed(db):
    for d in range(1, 6):  # Oct 1..5; Oct 3 has no data at all
        if d == 3:
            continue
        day = date(2026, 10, d)
        db.add(Sleep(id=f"s{d}", day=day, score=70 + d))
        db.add(Readiness(id=f"r{d}", day=day, score=60 + d, temperature_deviation=-0.123))
        db.add(Activity(id=f"a{d}", day=day, score=80 + d, steps=1000 * d))
    # Activity for today (partial) must not move latest_day forward.
    db.add(Activity(id="a6", day=date(2026, 10, 6), score=20, steps=500))
    # A nap and the main night on Oct 5.
    db.add(SleepSession(id="nap", day=date(2026, 10, 5), type="late_nap",
                        total_sleep_duration=1800, average_hrv=20, lowest_heart_rate=60))
    db.add(SleepSession(id="night", day=date(2026, 10, 5), type="long_sleep",
                        total_sleep_duration=27000, average_hrv=48, lowest_heart_rate=52))
    db.commit()


def test_build_summary(db):
    seed(db)
    now = datetime(2026, 10, 6, 11, 5, tzinfo=timezone.utc)
    s = build_summary(db, now=now)

    assert s["schema_version"] == 1
    assert s["generated_at"] == "2026-10-06T11:05:00+00:00"
    assert s["latest_day"] == "2026-10-05"
    assert s["latest"] == {
        "sleep_score": 75,
        "readiness_score": 65,
        "activity_score": 85,
        "total_sleep_seconds": 27000,
        "average_hrv": 48,
        "lowest_heart_rate": 52,
        "steps": 5000,
        "temperature_deviation": -0.12,
    }
    assert [t["day"] for t in s["trend"]] == [f"2026-09-{d}" for d in (29, 30)] + [
        f"2026-10-0{d}" for d in range(1, 6)
    ]
    assert s["trend"][4] == {"day": "2026-10-03", "sleep_score": None,
                             "readiness_score": None, "activity_score": None}
    assert s["trend"][-1]["sleep_score"] == 75


def test_build_summary_empty_db(db):
    s = build_summary(db)
    assert s["latest_day"] is None
    assert s["trend"] == []
    assert all(v is None for v in s["latest"].values())


def test_write_summary_to_configured_dir(db, tmp_path):
    seed(db)
    path = write_summary(db, export_dir=str(tmp_path / "Scriptable"))
    assert path == tmp_path / "Scriptable" / SUMMARY_FILENAME
    assert json.loads(path.read_text(encoding="utf-8"))["latest_day"] == "2026-10-05"
    assert [p.name for p in path.parent.iterdir()] == [SUMMARY_FILENAME]  # no temp files left
