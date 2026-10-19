"""Product catalogue. The ids are part of the app contract - do not rename."""

from __future__ import annotations

from dataclasses import dataclass

from .colormap import Legend
from .config import Settings

# MRMS CONUS grid outer edges (cell centres run -129.995..-60.005, 54.995..20.005).
MRMS_BOUNDS = (-130.0, 20.0, -60.0, 55.0)

MESH_LEGEND = Legend(
    unit="in",
    decimals=2,
    stops=(
        (0.10, "#8fd3ff"),
        (0.50, "#22b14c"),
        (0.75, "#ffe600"),
        (1.00, "#ff9a00"),  # 1" = NWS severe criterion
        (1.50, "#ff1f1f"),
        (2.00, "#e0129c"),
        (2.75, "#8c1cff"),  # baseball
        (4.00, "#ffffff"),
    ),
)

ROTATION_LEGEND = Legend(
    unit="s⁻¹",
    decimals=3,
    stops=(
        (0.004, "#9a9a9a"),
        (0.006, "#3cba54"),
        (0.008, "#f4e200"),
        (0.010, "#ff8c00"),
        (0.012, "#ff1a1a"),
        (0.016, "#d400d4"),
        (0.025, "#7a00ff"),
    ),
)

VIL_LEGEND = Legend(
    unit="kg/m²",
    decimals=0,  # 0-255 colour steps over 1-70 kg/m2 cannot resolve 0.1 everywhere
    stops=(
        (1.0, "#9cd8ff"),
        (5.0, "#2f7cff"),
        (10.0, "#00c853"),
        (20.0, "#ffeb3b"),
        (30.0, "#ff9800"),
        (40.0, "#f02a1d"),
        (55.0, "#c2187a"),
        (70.0, "#8e24aa"),
    ),
)


@dataclass(frozen=True)
class Product:
    id: str
    label: str
    kind: str  # "rgb" | "value"
    source: str  # "goes" | "mrms"
    composite: str | None = None  # satpy composite name (GOES)
    bands: tuple[str, ...] = ()  # ABI bands the composite needs (GOES)
    mrms_folder: str | None = None  # folder under CONUS/ in noaa-mrms-pds
    scale: float = 1.0  # source units -> legend units (MRMS)
    legend: Legend | None = None


CATALOG: tuple[Product, ...] = (
    Product(
        id="goes-dcp",
        label="Day Cloud Phase Distinction (GOES-19, daytime)",
        kind="rgb",
        source="goes",
        # satpy renamed the CIRA "Day Cloud Phase Distinction" recipe to
        # day_cloud_type_distinction; the old name is deprecated and needs
        # pyspectral Rayleigh LUT downloads. Stretch: R=C13 280.7->219.6 K,
        # G=C02 0-78 %, B=C05 1-59 % (satpy etc/enhancements/abi.yaml).
        composite="day_cloud_type_distinction",
        bands=("C02", "C05", "C13"),
    ),
    Product(
        id="goes-nightmicro",
        label="Nighttime Microphysics (GOES-19, night)",
        kind="rgb",
        source="goes",
        # R=C15-C13 -6.7..2.6 K, G=C13-C07 -3.1..5.2 K, B=C13 243.55..292.65 K
        # (satpy night_microphysics + ABI enhancement, CIRA quick guide).
        composite="night_microphysics",
        bands=("C07", "C13", "C15"),
    ),
    Product(
        id="goes-sandwich",
        label="IR Sandwich (GOES-19, daytime)",
        kind="rgb",
        source="goes",
        # satpy SandwichCompositor: C02 (sun-zenith corrected) luminance x
        # colourised C13; defined for ABI in satpy_config/composites/abi.yaml.
        composite="ir_sandwich",
        bands=("C02", "C13"),
    ),
    Product(
        id="mrms-mesh",
        label="MESH – Maximum Expected Size of Hail",
        kind="value",
        source="mrms",
        mrms_folder="MESH_00.50",
        scale=1.0 / 25.4,  # mm -> in
        legend=MESH_LEGEND,
    ),
    Product(
        id="mrms-mesh60",
        label="MESH 60-min Maximum",
        kind="value",
        source="mrms",
        mrms_folder="MESH_Max_60min_00.50",
        scale=1.0 / 25.4,
        legend=MESH_LEGEND,
    ),
    Product(
        id="mrms-rotation",
        label="Rotation Track 60 min (0–2 km AGL)",
        kind="value",
        source="mrms",
        mrms_folder="RotationTrack60min_00.50",
        scale=0.001,  # GRIB values are in 0.001 s^-1
        legend=ROTATION_LEGEND,
    ),
    Product(
        id="mrms-vil",
        label="Vertically Integrated Liquid",
        kind="value",
        source="mrms",
        mrms_folder="VIL_00.50",
        scale=1.0,
        legend=VIL_LEGEND,
    ),
)

BY_ID = {p.id: p for p in CATALOG}


def enabled_products(settings: Settings, override: str | None = None) -> list[Product]:
    spec = (override or settings.products or "all").strip()
    if spec.lower() == "all":
        return list(CATALOG)
    ids = [s.strip() for s in spec.split(",") if s.strip()]
    unknown = [i for i in ids if i not in BY_ID]
    if unknown:
        raise SystemExit(f"unknown product id(s): {', '.join(unknown)}; known: {', '.join(BY_ID)}")
    return [BY_ID[i] for i in ids]


def bounds_for(product: Product, settings: Settings) -> tuple[float, float, float, float]:
    return tuple(settings.goes_bounds) if product.source == "goes" else MRMS_BOUNDS
