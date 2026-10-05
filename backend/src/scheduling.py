"""
Sync schedule helpers: a daily run at `schedule_time`, or a weekly run on
`schedule_weekday` (0 = Monday ... 6 = Sunday) at that time.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict

FREQUENCIES = ("daily", "weekly")


@dataclass(frozen=True)
class Schedule:
    hour: int
    minute: int
    frequency: str = "daily"
    weekday: int = 0

    @classmethod
    def from_config(cls, cfg: Dict[str, Any]) -> "Schedule":
        hour, minute = parse_time(cfg.get("schedule_time", "11:00"))
        frequency = cfg.get("schedule_frequency", "daily")
        if frequency not in FREQUENCIES:
            frequency = "daily"
        weekday = int(cfg.get("schedule_weekday", 0) or 0)
        if not 0 <= weekday <= 6:
            weekday = 0
        return cls(hour, minute, frequency, weekday)

    def is_due(self, now: datetime) -> bool:
        """True during the scheduled minute (the worker checks once a minute)."""
        if (now.hour, now.minute) != (self.hour, self.minute):
            return False
        return self.frequency == "daily" or now.weekday() == self.weekday

    def next_run(self, now: datetime) -> datetime:
        candidate = now.replace(hour=self.hour, minute=self.minute, second=0, microsecond=0)
        if self.frequency == "weekly":
            candidate += timedelta(days=(self.weekday - now.weekday()) % 7)
            if now > candidate:
                candidate += timedelta(days=7)
        elif now > candidate:
            candidate += timedelta(days=1)
        return candidate


def parse_time(value: str):
    """'HH:MM' -> (hour, minute); raises ValueError if invalid."""
    hour, minute = map(int, value.split(":"))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"Invalid time: {value}")
    return hour, minute
