from trips.services.recommendation import RouteStats, explain, rank


def stats(name, no_travel=0.0, severe=0.0, high=0.0, avg=0.0, hours=10.0):
    return RouteStats(name, no_travel, severe, high, avg, hours)


def test_fewest_severe_miles_beats_faster_route():
    fast_but_severe = stats("A", severe=20, hours=8)
    slow_but_safe = stats("B", high=200, avg=1.5, hours=12)
    assert [s.name for s in rank([fast_but_severe, slow_but_safe])] == ["B", "A"]


def test_high_miles_break_severe_tie():
    ranked = rank([stats("A", severe=10, high=50), stats("B", severe=10, high=30)])
    assert ranked[0].name == "B"


def test_average_risk_breaks_high_tie():
    ranked = rank([stats("A", high=30, avg=0.9), stats("B", high=30, avg=0.4)])
    assert ranked[0].name == "B"


def test_travel_time_is_last_tiebreaker():
    ranked = rank([stats("A", hours=11), stats("B", hours=9), stats("C", hours=10)])
    assert [s.name for s in ranked] == ["B", "C", "A"]


def test_no_travel_miles_rank_before_severe():
    ranked = rank([stats("A", no_travel=5), stats("B", severe=300)])
    assert ranked[0].name == "B"


def test_float_noise_does_not_override_later_criteria():
    ranked = rank([stats("A", severe=10.00001, hours=8), stats("B", severe=10.0, hours=9)])
    assert ranked[0].name == "A"


def test_explain_names_the_deciding_criterion():
    ranked = rank([stats("A", severe=20, hours=8), stats("B", severe=0, hours=12)])
    assert explain(ranked) == "Route B has the fewest Severe miles (0 mi vs 20 mi on Route A)."


def test_explain_warns_when_every_route_has_no_travel():
    ranked = rank([stats("A", no_travel=10), stats("B", no_travel=30)])
    assert "consider delaying departure" in explain(ranked)
