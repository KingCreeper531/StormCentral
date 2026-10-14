# Storm Central X bot on your PC (twikit)

Runs the same bot as `bot/` (same warnings, same wording, same morning
outlook) from your own PC, posting through [twikit](https://github.com/d60/twikit)
with the account's browser cookies instead of the paid X API.

**Know the risk.** twikit isn't official. X's rules don't allow automating
the website, and X can lock or suspend an account it thinks is a bot. This
setup keeps that risk down (your own home connection, a daily cap, a minute
between posts, it stops by itself if X objects), but it can't remove it.

**It only ever posts as @Storm__Central.** Before every post it asks X whose
cookies these are; if they belong to any other account it refuses and stops,
and nothing is posted.

## What you need

- **Node.js** 20 or newer: <https://nodejs.org> (the LTS button).
- **Python** 3.10 or newer: <https://www.python.org/downloads/>. Tick
  **"Add python.exe to PATH"** in the installer.
- This repository on your PC: on GitHub, **Code → Download ZIP** and unzip
  it, or `git clone https://github.com/KingCreeper531/StormCentral`.

## 1. Get @Storm__Central's cookies

You have two X accounts, so do this in a **private window** where only
@Storm__Central is logged in:

1. Open a private window (Ctrl+Shift+N in Chrome or Edge) and go to
   <https://x.com>. Log in as **@Storm__Central**.
2. Press **F12** to open the developer tools.
   - Chrome / Edge: **Application** tab → **Cookies** → `https://x.com`.
   - Firefox: **Storage** tab → **Cookies** → `https://x.com`.
3. Find `auth_token` and `ct0` and copy each **Value**.
4. Close the private window. **Don't click Log out**: logging out ends the
   session and the cookies stop working. Just close the window.

## 2. Paste them in

Run `start.cmd` once (step 3). It creates `bot\local\cookies.json`. Open
it in Notepad and paste the two values:

```json
{
  "auth_token": "the auth_token value",
  "ct0": "the ct0 value"
}
```

These cookies are the account's login: anyone with them can post as
@Storm__Central. `cookies.json` is in `.gitignore` so it's never committed.
Don't share it or upload it anywhere.

## 3. Start it

Double-click **`bot\local\start.cmd`**. The first time, it sets up twikit
(a minute or so). Then it:

1. checks the login and prints **"Logged in as @Storm__Central"** (or stops
   if it's any other account),
2. builds the bot,
3. checks for new warnings every 5 minutes and posts them, plus the morning
   outlook, until you close the window.

To see what it would post without posting, run in PowerShell:

```powershell
cd path\to\StormCentral\bot\local
.\start.ps1 -DryRun
```

The very first real run only notes the warnings already in effect, so it
doesn't post a backlog; posting starts with the next new one.

## Settings

`bot\local\settings.env` (created on the first run):

| Setting | Default | |
|---|---|---|
| `BOT_X_ACCOUNT` | `Storm__Central` | The only account it may post as |
| `BOT_DAILY_LIMIT` | `30` | Posts per day (UTC); tornado and flash flood emergencies always go out |
| `BOT_MAX_PER_RUN` | `3` | Posts per 5-minute check |
| `BOT_MIN_GAP_S` | `60` | Seconds between posts |
| `BOT_INTERVAL_S` | `300` | Seconds between checks (at least 120) |
| `BOT_OUTLOOK` | `true` | The morning SPC outlook post |
| `BOT_LINKS` | `true` | Storm Central links in posts |

Keep the limits modest; posting like a machine is what gets accounts locked.

## If it stops

It stops by itself, with a beep, when X logs it out, locks the account,
says a post "looks automated", or the cookies are for the wrong account. Then:

1. Log in to x.com as @Storm__Central in a normal window and deal with
   whatever X asks (a captcha, a code, a password check).
2. Get fresh cookies (step 1) into `cookies.json`.
3. Double-click `start.cmd` again.

Other failures (no internet, the weather service down) just skip that check
and try again 5 minutes later.

## Keep it running

It only posts while the window is open and the PC is awake. To start it when
you log in: press **Win+R**, type `shell:startup`, and put a shortcut to
`start.cmd` in that folder. In Windows' power settings, set sleep to **Never**
while plugged in.

Also turn off the GitHub Actions bot (leave the `BOT_ENABLED` variable unset
or `false`), so the two don't both post.
