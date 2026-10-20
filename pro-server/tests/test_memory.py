import sys

import numpy as np

from pro_server import memory


def test_release_hands_freed_memory_back():
    big = np.ones(50_000_000, dtype=np.uint8)  # 50 MB
    before = memory.rss_mb()
    del big
    memory.release()
    if sys.platform.startswith("linux"):
        assert before > 0
        assert memory.rss_mb() < before - 30


def test_limit_is_configured_or_from_the_container():
    assert memory.limit_mb(1500) == 1500
    cg = memory.cgroup_limit_mb()
    assert memory.limit_mb(0) == (cg * 0.85 if cg else 0)
    assert not memory.over_limit(1e9)
    if sys.platform.startswith("linux"):
        assert memory.over_limit(1)
