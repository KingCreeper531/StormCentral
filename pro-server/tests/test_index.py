import datetime as dt
import json
import re

from pro_server.config import Settings
from pro_server.goes import scan_time
from pro_server.mrms import key_time
from pro_server import output
from pro_server.output import Manifest, frame_name, save_png
from pro_server.products import CATALOG

import numpy as np

ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
IDS = {"goes-dcp", "goes-nightmicro", "goes-sandwich", "mrms-mesh", "mrms-rotation", "mrms-vil"}


def test_required_product_ids_exist():
    assert IDS <= {p.id for p in CATALOG}


def test_filename_times():
    k = "ABI-L2-CMIPC/2026/292/12/OR_ABI-L2-CMIPC-M6C02_G19_s20262921201176_e20262921203549_c20262921203599.nc"
    band, _sid, t = scan_time(k)
    assert band == "C02" and t == dt.datetime(2026, 10, 19, 12, 1, 17, tzinfo=dt.timezone.utc)
    assert key_time("CONUS/MESH_00.50/20261019/MRMS_MESH_00.50_20261019-155038.grib2.gz") == dt.datetime(
        2026, 10, 19, 15, 50, 38, tzinfo=dt.timezone.utc)
    assert frame_name(dt.datetime(2026, 10, 19, 15, 51, 17, tzinfo=dt.timezone.utc)) == "20261019T155117Z.png"


def test_index_contract_and_pruning(tmp_path, monkeypatch):
    monkeypatch.setenv("OUTPUT_DIR", str(tmp_path))
    s = Settings()
    m = Manifest(s, list(CATALOG))
    t0 = dt.datetime(2026, 10, 19, 12, 0, tzinfo=dt.timezone.utc)
    px = np.zeros((2, 2, 4), np.uint8)
    for i in range(15):
        t = t0 + dt.timedelta(minutes=5 * i)
        for p in CATALOG:
            path, url = m.frame_path(p.id, t)
            save_png(px, path)
            m.add(p.id, t, url)
        m.write()
    on_disk_before = len(list((tmp_path / "goes-dcp").glob("*.png")))
    assert on_disk_before == 15  # dropped frames are kept for the grace period
    monkeypatch.setattr(output, "GRACE_SECONDS", 0)
    m.write()  # grace over: files no longer in the index are deleted
    idx = json.loads((tmp_path / "index.json").read_text())
    assert set(idx) == {"generated", "products"} and ISO.match(idx["generated"])
    for p in CATALOG:
        e = idx["products"][p.id]
        expected_keys = {"label", "kind", "bounds", "frames"} | ({"legend"} if p.kind == "value" else set())
        assert set(e) == expected_keys
        assert e["kind"] in ("rgb", "value") and len(e["bounds"]) == 4
        w, s_, east, n = e["bounds"]
        assert w < east and s_ < n
        times = [f["time"] for f in e["frames"]]
        assert len(times) == 12 and times == sorted(times) and all(ISO.match(x) for x in times)
        assert e["frames"][-1]["url"] == f"{p.id}/20261019T130999Z.png".replace("130999", "131000")
        on_disk = sorted(f.name for f in (tmp_path / p.id).glob("*.png"))
        assert on_disk == sorted(f["url"].split("/")[1] for f in e["frames"])
    # a restart picks the frames back up from index.json
    m2 = Manifest(s, list(CATALOG))
    assert m2.frames == m.frames
