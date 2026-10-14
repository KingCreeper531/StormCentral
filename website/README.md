# Storm Central website

The landing page at <https://www.stormcentralwx.com>: what the app does, a tour of
each mode, the trailer, and download links. Plain HTML, CSS and JavaScript with
no build step. It's separate from the web app, which stays a Next.js project.

| File | What it is |
|---|---|
| `index.html` | The page |
| `styles.css` | The app's design tokens (docs/DESIGN.md) and the page's layout and motion |
| `main.js` | Smooth scrolling, the hero radar, scroll effects, the trailer, and download links from the latest GitHub release |
| `vendor/` | [Lenis](https://github.com/darkroomengineering/lenis) 1.3.26 (smooth scrolling) and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4, both MIT |
| `assets/` | Icon, screenshots (WebP, from `store-assets/`), trailer, social card |
| `vercel.json` | Headers, caching and short links: `/app`, `/windows`, `/github`, `/privacy` |

The download buttons fill themselves in from the latest GitHub release (version,
file sizes, direct links, and a QR code for the APK), so a new release needs no
change here. Without JavaScript they link to the Releases page.

## Try it locally

```sh
cd website && python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import `KingCreeper531/StormCentral`.
2. **Root Directory:** `website`. **Framework Preset:** Other. Leave the
   build and output settings empty. Deploy.
3. In that project, open **Domains** (in the project's menu, not under
   Settings) and add `stormcentralwx.com`, keeping "Redirect apex domains to
   www" ticked, so the site lives at `https://www.stormcentralwx.com`.
4. Vercel lists the DNS records to create. At GoDaddy: **My Products →
   the domain → DNS → Manage DNS**:
   - the `A` record for `@` → the IP Vercel shows (remove GoDaddy's default
     `A` "Parked" record and any `@` forwarding first);
   - a `CNAME` record for `www` → the value Vercel shows.
5. Wait for Vercel to show the domain as valid (minutes, up to a few hours).
   HTTPS is set up automatically.

Pushes to `main` redeploy it; the `ignoreCommand` in `vercel.json` skips
builds when nothing in `website/` changed.
