"""
Writes a small JSON summary of the latest Oura data for home screen widgets
(see widgets/scriptable/OuraWidget.js). The file is regenerated after every
successful sync and can be placed in a synced folder such as iCloud Drive.
"""
import json
import logging
import os
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import config_manager
from .models import Activity, Readiness, Sleep, SleepSession
from .paths import get_user_data_dir

logger = logging.getLogger("WidgetExport")

SCHEMA_VERSION = 1
SUMMARY_FILENAME = "oura_summary.json"
TREND_DAYS = 7

# Scriptable's iCloud Drive folder, if iCloud Drive is synced to this machine.
SCRIPTABLE_ICLOUD_DIRS = {
    "win32": Path.home() / "iCloudDrive" / "iCloud~dk~simonbs~Scriptable",
    "darwin": Path.home() / "Library" / "Mobile Documents" / "iCloud~dk~simonbs~Scriptable" / "Documents",
}


def resolve_export_dir(configured: Optional[str] = None) -> Path:
    """
    Where to write the summary: the configured folder if set, otherwise the
    Scriptable iCloud folder when present, otherwise the app's user data dir.
    """
    if configured:
        return Path(os.path.expandvars(os.path.expanduser(configured)))
    icloud = SCRIPTABLE_ICLOUD_DIRS.get(sys.platform)
    if icloud and icloud.is_dir():
        return icloud
    return get_user_data_dir()


def _latest_day(db: Session) -> Optional[date]:
    """
    Most recent day with a sleep or readiness score. Activity for the current
    day is often partial, so it only decides when nothing else exists.
    """
    candidates = [
        db.scalar(select(func.max(Sleep.day)).where(Sleep.score.is_not(None))),
        db.scalar(select(func.max(Readiness.day)).where(Readiness.score.is_not(None))),
    ]
    days = [d for d in candidates if d is not None]
    if days:
        return max(days)
    return db.scalar(select(func.max(Activity.day)))


def _main_sleep_session(db: Session, day: date) -> Optional[SleepSession]:
    """The night's main sleep: a 'long_sleep' session if any, else the longest."""
    sessions = db.scalars(select(SleepSession).where(SleepSession.day == day)).all()
    if not sessions:
        return None
    return max(
        sessions,
        key=lambda s: (s.type == "long_sleep", s.total_sleep_duration or 0),
    )


def _scores_by_day(db: Session, model, start: date, end: date) -> Dict[date, Optional[int]]:
    rows = db.execute(
        select(model.day, model.score).where(model.day >= start, model.day <= end)
    ).all()
    return {day: score for day, score in rows}


def build_summary(db: Session, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Builds the widget summary dict (schema documented in widgets/scriptable/README.md)."""
    now = now or datetime.now().astimezone()
    latest_day = _latest_day(db)

    latest: Dict[str, Any] = {
        "sleep_score": None,
        "readiness_score": None,
        "activity_score": None,
        "total_sleep_seconds": None,
        "average_hrv": None,
        "lowest_heart_rate": None,
        "steps": None,
        "temperature_deviation": None,
    }
    trend = []

    if latest_day is not None:
        sleep = db.scalar(select(Sleep).where(Sleep.day == latest_day))
        readiness = db.scalar(select(Readiness).where(Readiness.day == latest_day))
        activity = db.scalar(select(Activity).where(Activity.day == latest_day))
        session = _main_sleep_session(db, latest_day)

        latest.update(
            sleep_score=sleep.score if sleep else None,
            readiness_score=readiness.score if readiness else None,
            activity_score=activity.score if activity else None,
            total_sleep_seconds=session.total_sleep_duration if session else None,
            average_hrv=session.average_hrv if session else None,
            lowest_heart_rate=session.lowest_heart_rate if session else None,
            steps=activity.steps if activity else None,
            temperature_deviation=(
                round(readiness.temperature_deviation, 2)
                if readiness and readiness.temperature_deviation is not None
                else None
            ),
        )

        start = latest_day - timedelta(days=TREND_DAYS - 1)
        sleep_scores = _scores_by_day(db, Sleep, start, latest_day)
        readiness_scores = _scores_by_day(db, Readiness, start, latest_day)
        activity_scores = _scores_by_day(db, Activity, start, latest_day)
        for i in range(TREND_DAYS):
            day = start + timedelta(days=i)
            trend.append({
                "day": day.isoformat(),
                "sleep_score": sleep_scores.get(day),
                "readiness_score": readiness_scores.get(day),
                "activity_score": activity_scores.get(day),
            })

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.isoformat(timespec="seconds"),
        "latest_day": latest_day.isoformat() if latest_day else None,
        "latest": latest,
        "trend": trend,
    }


def write_summary(db: Session, export_dir: Optional[str] = None) -> Path:
    """Builds the summary and writes it atomically. Returns the file path."""
    if export_dir is None:
        export_dir = config_manager.get_config().get("widget_export_dir")
    target_dir = resolve_export_dir(export_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / SUMMARY_FILENAME

    summary = build_summary(db)
    tmp_path = target_dir / f".{SUMMARY_FILENAME}.{uuid.uuid4().hex}.tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    logger.info(f"Widget summary written to {path} (latest day: {summary['latest_day']})")
    return path


def export_widget_summary(db: Session) -> Optional[Path]:
    """Post-sync hook: writes the summary but never fails the sync."""
    try:
        return write_summary(db)
    except Exception as e:
        logger.error(f"Failed to write widget summary: {e}")
        return None
