import math

from trips.services.geo import haversine_mi, inverse_mercator_y, mercator_y
from trips.services.heatmap import CORRIDOR_HALF_WIDTH_MI, MAX_CELLS, build_grid


def test_mercator_roundtrip():
    for lat in (-60, 0, 33.3, 47.9):
        assert math.isclose(inverse_mercator_y(mercator_y(lat)), lat, abs_tol=1e-9)


def test_grid_cells_stay_inside_corridor_and_under_cap():
    corridor = [(35 + i * 0.1, -110 + i * 0.15) for i in range(150)]
    grid, cells = build_grid(corridor)
    assert 0 < len(cells) <= MAX_CELLS
    for idx, centre in cells:
        assert 0 <= idx < grid["rows"] * grid["cols"]
        nearest = min(haversine_mi(centre, p) for p in corridor)
        assert nearest <= CORRIDOR_HALF_WIDTH_MI * 1.02  # small slack for the flat-earth check


def test_grid_rows_are_even_in_mercator():
    corridor = [(30.0, -100.0), (45.0, -100.0)]
    grid, cells = build_grid(corridor)
    span = mercator_y(grid["north"]) - mercator_y(grid["south"])
    cell_x = math.radians((grid["east"] - grid["west"]) / grid["cols"])
    assert math.isclose(span / grid["rows"], cell_x, rel_tol=1e-9)
