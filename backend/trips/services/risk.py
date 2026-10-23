"""Weather risk classification (pure functions, no I/O).

Band boundaries
---------------
The spec gives integer/decimal ranges ("25–34 mph", "0.10–0.25 in/hr"). For continuous
forecast values we treat each band's lower bound as inclusive, e.g. wind 34.9 mph is
Moderate and 35.0 is High. The top band is written as "≥55" for wind but ">1.00" / ">3.0"
for rain and snow, so exactly 1.00 in/hr of rain is Severe, not No Travel.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class RiskLevel(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return self.name.replace("_", " ").title()

    @property
    def key(self) -> str:
        return self.name.lower()


@dataclass(frozen=True)
class Bands:
    """Lower bounds for Moderate, High, Severe and No Travel."""

    bounds: tuple[float, float, float, float]
    no_travel_inclusive: bool
    unit: str

    def classify(self, value: float) -> RiskLevel:
        level = RiskLevel.LOW
        for idx, bound in enumerate(self.bounds[:3], start=1):
            if value >= bound:
                level = RiskLevel(idx)
        top = self.bounds[3]
        if value > top or (self.no_travel_inclusive and value >= top):
            level = RiskLevel.NO_TRAVEL
        return level


WIND_BANDS = Bands((25, 35, 45, 55), no_travel_inclusive=True, unit="mph")
RAIN_BANDS = Bands((0.10, 0.25, 0.50, 1.00), no_travel_inclusive=False, unit="in/hr")
SNOW_BANDS = Bands((0.5, 1.0, 2.0, 3.0), no_travel_inclusive=False, unit="in/hr")

# Load rules: (min wind mph, max wind mph exclusive, load strictly above lb, resulting level)
LOAD_RULES: tuple[tuple[float, float, float, RiskLevel], ...] = (
    (45, 55, 30_000, RiskLevel.NO_TRAVEL),
    (35, 45, 40_000, RiskLevel.SEVERE),
)


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    gust_mph: float | None
    rain_in_hr: float
    snow_in_hr: float


@dataclass
class RiskAssessment:
    level: RiskLevel
    wind: RiskLevel
    rain: RiskLevel
    snow: RiskLevel
    factors: list[str] = field(default_factory=list)


def assess(sample: WeatherSample, load_weight_lb: float) -> RiskAssessment:
    """Classify one checkpoint. Overall risk is the worst of wind, rain, snow and load rules."""
    wind = WIND_BANDS.classify(sample.wind_mph)
    rain = RAIN_BANDS.classify(sample.rain_in_hr)
    snow = SNOW_BANDS.classify(sample.snow_in_hr)
    level = max(wind, rain, snow)
    factors: list[str] = []

    if wind > RiskLevel.LOW:
        factors.append(f"Wind {sample.wind_mph:.0f} mph ({wind.label})")
    if rain > RiskLevel.LOW:
        factors.append(f"Rain {sample.rain_in_hr:.2f} in/hr ({rain.label})")
    if snow > RiskLevel.LOW:
        factors.append(f"Snow {sample.snow_in_hr:.2f} in/hr ({snow.label})")

    for wind_min, wind_max, load_above, rule_level in LOAD_RULES:
        if wind_min <= sample.wind_mph < wind_max and load_weight_lb > load_above and rule_level > level:
            level = rule_level
            factors.append(
                f"{load_weight_lb:,.0f} lb load in {sample.wind_mph:.0f} mph wind "
                f"(> {load_above:,.0f} lb at {wind_min:.0f}–{wind_max - 1:.0f} mph) → {rule_level.label}"
            )

    return RiskAssessment(level=level, wind=wind, rain=rain, snow=snow, factors=factors)
