# Storm Central pro data server

A small self-hosted processor that turns free NOAA data on AWS into map overlays
that a browser can't practically make itself. The Storm Central app shows them in
**Professional mode**. Every ~2 minutes it:

1. polls the public NOAA buckets (anonymous HTTPS, no AWS account needed),
2. processes only source files it hasn't seen yet,
3. writes one Web Mercator PNG per product and time, plus `index.json`.

[Caddy](https://caddyserver.com) serves the output directory over HTTPS with the
CORS and cache headers the app needs.

| id | Product | Source | Kind | Notes |
|---|---|---|---|---|
| `goes-dcp` | Day Cloud Phase Distinction | GOES-19 ABI L2 CMIP CONUS, bands C02, C05, C13 | rgb | Daytime only. satpy `day_cloud_type_distinction` (the CIRA DCP recipe: R = C13 7.5 → −53.5 °C, G = C02 0–78 %, B = C05 1–59 %). |
| `goes-nightmicro` | Nighttime Microphysics | C07, C13, C15 | rgb | Night only. satpy `night_microphysics` with its ABI/CIRA stretch (R = C15−C13 −6.7…2.6 K, G = C13−C07 −3.1…5.2 K, B = C13 243.55…292.65 K). |
| `goes-sandwich` | IR Sandwich | C02, C13 | rgb | Daytime only. satpy `SandwichCompositor`: sun-zenith-corrected C02 visible × C13 coloured with satpy's `colorized_ir_clouds` (spectral palette −80 → −20 °C, greys above). |
| `mrms-mesh` | MESH, Maximum Expected Size of Hail | MRMS `CONUS/MESH_00.50` | value | mm in the GRIB, shown in **inches**. |
| `mrms-mesh60` | MESH 60-min maximum | MRMS `CONUS/MESH_Max_60min_00.50` | value | inches. Optional extra product. |
| `mrms-rotation` | Rotation Track, 60 min, 0–2 km AGL | MRMS `CONUS/RotationTrack60min_00.50` | value | GRIB unit is 0.001 s⁻¹. Shown in **s⁻¹** (0.004 … 0.025). `RotationTrackML*` is the 3–6 km mid-level track and is not used. |
| `mrms-vil` | Vertically Integrated Liquid | MRMS `CONUS/VIL_00.50` | value | kg/m². |

The labels in `index.json` say whether a product is a day or night product. All
three GOES RGBs are made around the clock. A day product at night (or the night
product by day) is technically valid but not meteorologically useful. The app can
pick based on time of day.

## Output contract

```
GET /index.json                      Cache-Control: no-cache
GET /<product-id>/<YYYYMMDDTHHMMSSZ>.png   Cache-Control: public, max-age=86400, immutable
```

Every response carries `Access-Control-Allow-Origin: *`, including 404s.

```json
{
  "generated": "2026-10-19T16:49:36Z",
  "products": {
    "goes-dcp": {
      "label": "Day Cloud Phase Distinction (GOES-19, daytime)",
      "kind": "rgb",
      "bounds": [-140.0, 14.5, -53.0, 56.5],
      "frames": [{ "time": "2026-10-19T16:41:17Z", "url": "goes-dcp/20261019T164117Z.png" }]
    },
    "mrms-mesh": {
      "label": "MESH – Maximum Expected Size of Hail",
      "kind": "value",
      "bounds": [-130.0, 20.0, -60.0, 55.0],
      "frames": [{ "time": "2026-10-19T16:46:40Z", "url": "mrms-mesh/20261019T164640Z.png" }],
      "legend": { "unit": "in", "decimals": 2, "stops": [{ "value": 0.1, "color": "#8fd3ff" }, "…"] }
    }
  }
}
```

* `bounds` = `[west, south, east, north]` in degrees. Each PNG covers exactly those
  bounds. Pixel x is linear in longitude and pixel y is linear in Web Mercator Y
  (EPSG:3857). Place it as a MapLibre `image` source with the four corners
  `[[w,n],[e,n],[e,s],[w,s]]`.
* `frames` are sorted oldest → newest. The newest `KEEP_FRAMES` (12) per product
  are kept. Older PNGs are deleted 5 minutes after they leave the index, so a
  client holding a slightly older index can still load every frame it lists.
* `time` is the GOES scan start time or the MRMS valid time (UTC).
* Products that have no frames yet appear with `"frames": []`.
* `legend` appears only on `value` products. Stops ascend. Every opaque pixel is
  exactly a stop colour or the per-channel linear interpolation between two
  consecutive stops, rounded to the nearest integer. Alpha is 255 for data and 0
  for "nothing" (missing, no coverage, zero, or below the first stop). Values above
  the last stop use the last colour, so read that colour back as "≥ last stop".
  To read a value back, project the pixel RGB onto each stop segment, take the
  nearest one and interpolate. `Legend.invert()` in `pro_server/colormap.py` is the
  reference implementation. The round-trip error is under one displayed unit
  (`decimals`), and `tests/test_colormap.py` checks this.
* Image sizes: GOES 3000 × 1867 px, MRMS 3500 × 2286 px. Both stay below 4096 px,
  the WebGL texture limit on many phones.

### How the images are made

**GOES.** For each 5-minute CONUS scan, the server downloads the needed
`ABI-L2-CMIPC` band files from `noaa-goes19`, about 93 MB per scan, almost all of
it C02. satpy (`abi_l2_nc` reader) does the rest:

* It block-averages every band to the common 2 km grid (`resampler="native"`), so
  the 6000 × 10000 C02 array never goes through the composite or resample steps.
* It builds the composite with satpy's own recipe and modifiers.
* pyresample's gradient search (bilinear) reprojects it to the EPSG:3857 grid.
* satpy's enhancement (stretch) is applied. Pixels with no data, such as outside
  the CONUS sector or at the limb, are transparent.

At 3000 px the output pixel is about 2.1 km at 50° N and 2.8 km at 30° N. That
matches the 2 km IR bands, which are actually 3–4 km over the western US because of
the view angle. If you raise `GOES_WIDTH` so that pixels are smaller than 1.5 km at
40° N (about 4300 px or more), the server aggregates to 1 km instead.

**MRMS.** The server decodes the gzipped GRIB2 with pygrib, which bundles ecCodes.
The 0.01° grids (0.005° for the rotation track) are **max-pooled** onto the
Mercator grid, so small hail cores and rotation maxima don't disappear. Values ≤ 0
(MRMS uses −1 / −3 / −99 / −999 sentinels for missing or no coverage) are
transparent. The server then converts units and applies the fixed colour table in
`pro_server/products.py`.

## Resource needs

These numbers were measured in an x86-64 sandbox with 4 vCPUs. The Ampere A1 should
be in the same range, perhaps 1.5× slower per core. Default settings, all 7
products:

| | per GOES scan (every 5 min) | per MRMS file (≈ every 2 min, ×4 products) |
|---|---|---|
| Download (inbound) | ~93 MB → **~1.1 GB/h** | 30–200 KB → ~15 MB/h |
| CPU time | 10–20 s wall with 2–4 threads | MESH/VIL 1.5–3 s, rotation 6–8 s |
| Peak RAM | ~0.6–0.7 GB (`DASK_WORKERS=2`) | **~1.0 GB** for the 0.005° rotation grid (ecCodes decodes 98 M doubles); ~0.3 GB for the others |
| Output PNG | DCP ~6.5 MB, Night Micro ~5 MB, Sandwich ~4 MB | 30–40 KB on a quiet day, a few hundred KB with widespread storms |

* **RAM:** plan for 1.5 GB or more for the processor container, plus about 50 MB
  for Caddy. The processor idles at about 150 MB.
* **CPU:** about 10 min of CPU per hour in total. Two A1 OCPUs are plenty.
* **Disk:** the Docker image is about 0.7 GB. Output with 12 frames is about
  200 MB, almost all GOES. Temporary GOES downloads (~100 MB) are deleted after
  each scan.
* **Outbound bandwidth** depends on viewers. One client loading a full 12-frame loop
  of all three GOES products pulls about 190 MB. MRMS loops are about 0.5–5 MB. PNGs
  are `immutable`, so browsers fetch each frame only once. Oracle's free tier
  includes 10 TB/month of egress.

**Which Oracle shape?** Use the Always Free **Ampere A1 Flex**
(`VM.Standard.A1.Flex`, arm64). For example, 2 OCPU and 12 GB RAM, or all 4 OCPU
and 24 GB. The **E2.1.Micro** (AMD, 1 GB RAM, 1/8 OCPU) is not a good fit. If you
must use it, add a 2 GB swap file and run only the MRMS products
(`PRODUCTS=mrms-mesh,mrms-mesh60,mrms-vil`, plus `mrms-rotation` if swap is on). Its
CPU is too slow for GOES every 5 minutes.

## Run it locally

```bash
cd pro-server
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pro_server --once                  # latest frame of every product → ./output, then exit (~30–40 s)
.venv/bin/python -m pytest -q tests                     # mapping, legend round trip, pooling, index contract
.venv/bin/python -m pro_server --serve 8080             # update loop + built-in server on http://127.0.0.1:8080/index.json
```

`--products goes-dcp,mrms-mesh` limits a run to some products. `--serve PORT`
starts a small built-in server with the same headers as the Caddyfile. It is fine
for the **desktop app**, which can use `http://127.0.0.1:PORT`. Use Caddy for
anything public.

Settings (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `OUTPUT_DIR` / `WORK_DIR` | `./output` / `./work` | served directory / temp downloads |
| `PRODUCTS` | `all` | comma-separated product ids |
| `POLL_SECONDS` | 120 | poll interval |
| `KEEP_FRAMES` | 12 | frames kept per product |
| `BACKFILL_FRAMES` | 3 | frames to fetch on a cold start (empty output) |
| `GOES_WIDTH` | 3000 | GOES PNG width (height follows) |
| `GOES_BOUNDS` | `-140,14.5,-53,56.5` | GOES image bounds |
| `GOES_BUCKET` | `noaa-goes19` | GOES-East bucket |
| `MRMS_WIDTH` | 3500 | MRMS PNG width (0.02° per px) |
| `MRMS_MIN_SPACING_MINUTES` | 0 | e.g. 4 = skip MRMS files closer than 4 min to the previous one, so a 12-frame loop spans ~48 min |
| `DASK_WORKERS` | min(4, CPUs); compose uses 2 | threads for the GOES step (more = faster, more RAM) |
| `PNG_COMPRESS_LEVEL` | 6 | zlib level |
| `LOG_LEVEL` | INFO | |

## Deploy on Oracle Cloud Free Tier

### 1. Create the VM

1. In the OCI console, go to **Compute → Instances → Create instance**.
2. Image: **Canonical Ubuntu 24.04** (the aarch64 build is picked automatically for A1).
3. Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPU and 12 GB RAM, or whatever is
   left of your free 4 OCPU / 24 GB.
4. Networking: a public subnet with **Assign a public IPv4 address**. For a stable
   address, reserve a public IP under **Networking → IP management → Reserved public
   IPs** and attach it.
5. Add your SSH public key. A 50 GB boot volume is plenty, and up to 200 GB is free.

### 2. Open ports 80 and 443 in the VCN

Go to **Networking → Virtual cloud networks → (your VCN) → Security Lists → Default
Security List → Add Ingress Rules**:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |
| `0.0.0.0/0` | UDP | 443 (optional, HTTP/3) |

If the subnet uses a Network Security Group, add the same rules there.

### 3. Open them on the instance firewall too

Oracle's Ubuntu images ship iptables rules that reject everything except SSH:

```bash
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT
sudo iptables -I INPUT -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save        # persists to /etc/iptables/rules.v4
```

On Oracle Linux images (firewalld) use this instead:

```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

Docker adds its own FORWARD rules for published ports when it starts.

### 4. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh     # supports arm64; installs the compose plugin
sudo usermod -aG docker $USER && newgrp docker
docker compose version
```

### 5. DNS name, needed for HTTPS

**No domain?** Use [sslip.io](https://sslip.io): the name `<your-ip-with-dashes>.sslip.io`
already resolves to that IP (e.g. `129-146-12-34.sslip.io` → `129.146.12.34`), and Caddy can get a
certificate for it. Set `DOMAIN=129-146-12-34.sslip.io` with your own IP and skip the rest of this step.

With your own domain, create an **A record** (e.g. `pro.example.com`) pointing at the instance's public
IP. Any registrar works. A free DuckDNS subdomain also works, because Caddy uses
the HTTP-01 challenge on port 80. Wait until `dig +short pro.example.com` returns
the IP.

### 6. Clone and start

```bash
git clone https://github.com/<you>/StormCentral.git
cd StormCentral/pro-server
cp .env.example .env
nano .env                      # set DOMAIN=pro.example.com
docker compose up -d --build   # first build takes a few minutes
docker compose logs -f processor
```

Within about 2 minutes `https://pro.example.com/index.json` should answer. Caddy
gets and renews the certificate automatically. Check it with:

```bash
curl -sI https://pro.example.com/index.json | grep -iE 'HTTP/|access-control|cache-control'
```

To update, run `git pull && docker compose up -d --build`. If you leave `DOMAIN`
empty, Caddy serves plain HTTP on port 80. That is useful for a first smoke test
(`curl http://<ip>/index.json`), but the web app cannot use it (see below).

## HTTPS is required

The Storm Central web app is served over HTTPS, so browsers block requests to an
`http://` server as mixed content. A public pro server therefore needs one of:

* **A domain with Caddy** (above). This is the recommended setup.
* **A Cloudflare Tunnel**, which needs no open inbound ports and no certificate on
  the VM. Run Caddy on `:80` (leave `DOMAIN` empty) and point a tunnel at it:
  `cloudflared tunnel --url http://localhost:80` gives a temporary
  `*.trycloudflare.com` URL for testing. A named tunnel on a domain in your
  Cloudflare account gives a permanent one. Cloudflare may cache the PNGs
  (`immutable`) but respects `no-cache` on `index.json`.
* **The desktop app only:** it may use `http://127.0.0.1:PORT` (e.g. `--serve 8080`
  on the same machine). Loopback is not treated as mixed content.

## Using it in the app

Turn on **Settings → General → Professional mode**, enter the base URL in
**Pro data server** (e.g. `https://pro.example.com` or `https://129-146-12-34.sslip.io`)
and press **Save**. It says "Connected." once `index.json` answers. Then pick a product
in any Pro panel: Day Cloud Phase, Night Fog and IR Sandwich under Satellite, and
the MRMS hail size, rotation track and VIL products under Radar (national).

## Files

```
pro_server/
  __main__.py      CLI: --once, --serve PORT, --products, update loop
  config.py        environment settings
  products.py      product catalogue, bounds, legends (colour tables)
  goes.py          GOES listing/download + satpy pipeline
  mrms.py          MRMS listing/download + GRIB2 decode
  regrid.py        max-pooling lat/lon grid → Web Mercator
  mercator.py      EPSG:3857 maths, pyresample AreaDefinition
  colormap.py      value → colour (+ reference colour → value)
  output.py        atomic PNG/index writes, frame bookkeeping, pruning
  s3.py            anonymous S3 listing/downloads (plain HTTPS)
  serve.py         optional built-in static server
  satpy_config/composites/abi.yaml   ABI ir_sandwich (satpy ships it only for SEVIRI/FCI)
tests/             pytest
Dockerfile, docker-compose.yml, Caddyfile, .env.example
requirements.in    direct deps; requirements.txt is the full pinned lock (same on amd64/arm64)
```

## Limitations and notes

* GOES-19 is GOES-East as of 2025. If NOAA swaps satellites, set `GOES_BUCKET`.
  The bounds stay valid for any GOES-East CONUS sector.
* `day_cloud_type_distinction` is satpy's current name for the DCP recipe. The old
  `cloud_phase_distinction` is deprecated and needs pyspectral Rayleigh look-up
  tables downloaded at runtime.
* The IR Sandwich uses satpy's generic (SEVIRI/FCI) sandwich recipe mapped to ABI
  bands. It is not a CIRA/NOAA-specific recipe.
* MRMS units (MESH mm, VIL kg/m², rotation 0.001 s⁻¹) follow the MRMS GRIB2 table
  and match the observed value ranges. The table itself could not be fetched while
  testing.
* A frame that fails to process is logged and skipped. It is retried on the next
  poll unless a newer frame of that product has been written since.
* After an outage, the server only looks back 3 hours and processes at most
  `KEEP_FRAMES` frames per product.
