"""Route ranking.

Same order as the spec (Severe miles, High miles, average risk, travel time), with No Travel
miles compared first so an undrivable route can't win on having fewer Severe miles.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RouteStats:
    name: str
    no_travel_miles: float
    severe_miles: float
    high_miles: float
    avg_risk: float
    duration_h: float

    def rank_key(self) -> tuple[float, ...]:
        # Rounded so float noise can't outrank a real difference in a later criterion.
        return (
            round(self.no_travel_miles, 1),
            round(self.severe_miles, 1),
            round(self.high_miles, 1),
            round(self.avg_risk, 2),
            round(self.duration_h, 3),
        )


def _hm(hours: float) -> str:
    total = round(hours * 60)
    return f"{total // 60}h {total % 60:02d}m"


_CRITERIA = (
    ("fewest No Travel miles", lambda s: f"{s.no_travel_miles:.0f} mi"),
    ("fewest Severe miles", lambda s: f"{s.severe_miles:.0f} mi"),
    ("fewest High miles", lambda s: f"{s.high_miles:.0f} mi"),
    ("lowest average risk", lambda s: f"{s.avg_risk:.2f}"),
    ("shortest travel time", lambda s: _hm(s.duration_h)),
)


def rank(stats: list[RouteStats]) -> list[RouteStats]:
    return sorted(stats, key=RouteStats.rank_key)


def explain(ranked: list[RouteStats]) -> str:
    """One sentence on why ranked[0] beat the runner-up."""
    best = ranked[0]
    if len(ranked) == 1:
        reason = f"Route {best.name} is the only drivable option found."
    else:
        runner = ranked[1]
        reason = f"Route {best.name} ties with Route {runner.name} on every criterion."
        for (label, fmt), a, b in zip(_CRITERIA, best.rank_key(), runner.rank_key()):
            if a != b:
                reason = f"Route {best.name} has the {label} ({fmt(best)} vs {fmt(runner)} on Route {runner.name})."
                break
    if best.no_travel_miles > 0:
        reason += " Every route crosses No Travel conditions — consider delaying departure."
    return reason
