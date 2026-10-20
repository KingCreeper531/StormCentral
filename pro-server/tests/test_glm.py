import datetime as dt
import json

import netCDF4
import numpy as np

from pro_server.config import Settings
from pro_server.glm import Lightning, Window, key_time, read_flashes


def _lcfa(lats, lons, offsets, quality=None, energy=None) -> bytes:
    """A minimal GLM LCFA file in memory: just the flash variables read_flashes uses."""
    ds = netCDF4.Dataset("x.nc", "w", memory=1024)
    ds.createDimension("number_of_flashes", len(lats))
    for name, values, dtype in (("flash_lat", lats, "f4"), ("flash_lon", lons, "f4"), ("flash_energy", energy or [3e-15] * len(lats), "f4"),
                                ("flash_quality_flag", quality or [0] * len(lats), "i2")):
        ds.createVariable(name, dtype, ("number_of_flashes",))[:] = values
    t = ds.createVariable("flash_time_offset_of_first_event", "f4", ("number_of_flashes",))
    t.units = "seconds since 2026-10-20 18:43:20.000"
    t[:] = offsets
    return bytes(ds.close())


def test_key_time():
    k = "GLM-L2-LCFA/2026/293/18/OR_GLM-L2-LCFA_G19_s20262931843200_e20262931843400_c20262931843419.nc"
    assert key_time(k) == dt.datetime(2026, 10, 20, 18, 43, 20, tzinfo=dt.timezone.utc)
    assert key_time("GLM-L2-LCFA/2026/293/18/") is None


def test_reads_good_flashes_with_times():
    lon, lat, t, energy = read_flashes(_lcfa([35.3, 36.0, 40.0], [-97.5, -96.0, -90.0], [1.5, 10.0, 19.0], quality=[0, 1, 0]))
    assert list(np.round(lat, 1)) == [35.3, 40.0]  # the flagged flash is dropped
    base = dt.datetime(2026, 10, 20, 18, 43, 20, tzinfo=dt.timezone.utc).timestamp()
    assert list(t) == [base + 1.5, base + 19.0]
    assert np.allclose(energy, 3.0, atol=0.01)  # fJ
    assert read_flashes(_lcfa([], [], []))[0].size == 0


def test_window_keeps_the_last_minutes_oldest_first():
    w = Window(minutes=15)
    now = 1_000_000.0
    w.add(np.array([-97.0, -96.0, -95.0]), np.array([35.0, 36.0, 37.0]), np.array([now - 60, now - 2000, now - 5]), np.array([1.0, 2.0, 3.0]))
    w.prune(now)
    assert list(w.lon) == [-97.0, -95.0]
    out = w.to_json(now)
    assert out["flashes"] == [[-97.0, 35.0, 60, 1], [-95.0, 37.0, 5, 3]]
    json.dumps(out)


def test_each_satellite_covers_its_own_side():
    s = Settings()
    s.lightning_split_lon = -106.0
    s.lightning_bounds = (-170.0, 5.0, -50.0, 72.0)
    l = Lightning(s)
    east, west = l.sats
    lon = np.array([-120.0, -100.0, -40.0, -100.0])
    lat = np.array([40.0, 40.0, 40.0, 80.0])
    assert list(l._area(east, lon, lat)) == [False, True, False, False]
    assert list(l._area(west, lon, lat)) == [True, False, False, False]
