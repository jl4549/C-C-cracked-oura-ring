from datetime import datetime

import pytest

from backend.src.scheduling import Schedule, parse_time

# 2026-10-05 is a Monday.
MON_0900 = datetime(2026, 10, 5, 9, 0, 30)


def test_daily_next_run_same_day_and_next_day():
    s = Schedule(11, 0)
    assert s.next_run(MON_0900) == datetime(2026, 10, 5, 11, 0)
    assert s.next_run(datetime(2026, 10, 5, 12, 0)) == datetime(2026, 10, 6, 11, 0)


def test_daily_is_due_only_in_scheduled_minute():
    s = Schedule(9, 0)
    assert s.is_due(MON_0900)
    assert not s.is_due(datetime(2026, 10, 5, 9, 1))


def test_weekly_next_run_later_this_week():
    s = Schedule(11, 0, "weekly", weekday=3)  # Thursday
    assert s.next_run(MON_0900) == datetime(2026, 10, 8, 11, 0)


def test_weekly_next_run_wraps_to_next_week():
    s = Schedule(8, 0, "weekly", weekday=0)  # Monday, already passed today
    assert s.next_run(MON_0900) == datetime(2026, 10, 12, 8, 0)


def test_weekly_is_due_only_on_weekday():
    s = Schedule(9, 0, "weekly", weekday=0)
    assert s.is_due(MON_0900)
    assert not s.is_due(datetime(2026, 10, 6, 9, 0))


def test_from_config_defaults_and_invalid_values():
    assert Schedule.from_config({}) == Schedule(11, 0, "daily", 0)
    cfg = {"schedule_time": "07:30", "schedule_frequency": "monthly", "schedule_weekday": 9}
    assert Schedule.from_config(cfg) == Schedule(7, 30, "daily", 0)


def test_parse_time_rejects_invalid():
    with pytest.raises(ValueError):
        parse_time("25:00")
