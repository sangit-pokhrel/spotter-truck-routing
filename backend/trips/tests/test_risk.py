import pytest

from trips.services.risk import RAIN_BANDS, SNOW_BANDS, WIND_BANDS, RiskLevel, WeatherSample, assess

L, M, H, S, N = RiskLevel


def sample(wind=0.0, rain=0.0, snow=0.0):
    return WeatherSample(wind_mph=wind, gust_mph=None, rain_in_hr=rain, snow_in_hr=snow)


@pytest.mark.parametrize(
    "value, expected",
    [(0, L), (24.9, L), (25, M), (34.9, M), (35, H), (44.9, H), (45, S), (54.9, S), (55, N), (80, N)],
)
def test_wind_bands(value, expected):
    assert WIND_BANDS.classify(value) == expected


@pytest.mark.parametrize(
    "value, expected",
    [(0, L), (0.099, L), (0.10, M), (0.249, M), (0.25, H), (0.50, S), (1.00, S), (1.01, N)],
)
def test_rain_bands_top_is_strictly_greater(value, expected):
    assert RAIN_BANDS.classify(value) == expected


@pytest.mark.parametrize(
    "value, expected",
    [(0.49, L), (0.5, M), (1.0, H), (2.0, S), (3.0, S), (3.01, N)],
)
def test_snow_bands(value, expected):
    assert SNOW_BANDS.classify(value) == expected


def test_overall_level_is_worst_condition():
    result = assess(sample(wind=26, rain=0.3, snow=0.1), load_weight_lb=10_000)
    assert (result.wind, result.rain, result.snow) == (M, H, L)
    assert result.level == H
    assert len(result.factors) == 2


def test_wind_55_is_no_travel_for_any_load():
    assert assess(sample(wind=55), load_weight_lb=1).level == N


@pytest.mark.parametrize(
    "wind, load, expected",
    [
        (45, 30_000, S),  # exactly 30,000 lb is not "> 30,000"
        (45, 30_001, N),
        (54.9, 45_000, N),
        (35, 40_000, H),  # exactly 40,000 lb is not "> 40,000"
        (35, 40_001, S),
        (44.9, 60_000, S),
        (34.9, 80_000, M),  # below the 35 mph rule
    ],
)
def test_load_rules(wind, load, expected):
    assert assess(sample(wind=wind), load_weight_lb=load).level == expected


def test_load_rule_never_lowers_a_worse_condition():
    result = assess(sample(wind=36, rain=1.5), load_weight_lb=50_000)
    assert result.level == N


def test_load_rule_is_explained():
    result = assess(sample(wind=40), load_weight_lb=45_000)
    assert any("load" in f for f in result.factors)
