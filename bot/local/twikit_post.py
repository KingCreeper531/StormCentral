"""
Posts one message to X through twikit, as the account whose browser cookies
are in cookies.json. bot/main.ts runs it (BOT_POSTER=twikit) with the post on
stdin, {"text": "...", "image": "path or null"}, and reads one JSON line back:

  {"ok": true, "id": "...", "image": true}
  {"ok": false, "kind": "duplicate|rate|locked|suspended|unauthorized|automated|rejected|error", "message": "..."}

Before anything is posted it checks who the cookies log in as, and refuses
unless it's the expected account (--account, default Storm__Central), so a
cookie from another account can never post.

  python twikit_post.py --cookies cookies.json --check   # just say who's logged in
"""

import argparse
import asyncio
import json
import sys

from twikit import Client
from twikit.errors import (
    AccountLocked,
    AccountSuspended,
    CouldNotTweet,
    DuplicateTweet,
    Forbidden,
    TooManyRequests,
    Unauthorized,
)


def answer(**fields):
    print(json.dumps(fields), flush=True)


def load_cookies(path):
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    # Either {"auth_token": "...", "ct0": "..."} or a browser export: [{"name": ..., "value": ...}, ...]
    if isinstance(raw, list):
        raw = {c["name"]: c["value"] for c in raw if "name" in c and "value" in c}
    missing = [k for k in ("auth_token", "ct0") if not raw.get(k)]
    if missing:
        raise ValueError(f"cookies file is missing {', '.join(missing)}")
    if any(str(raw[k]).startswith("paste ") for k in ("auth_token", "ct0")):
        raise ValueError("cookies.json still has the example text; paste the real auth_token and ct0")
    return raw


async def run(args):
    client = Client(language="en-US")
    client.set_cookies(load_cookies(args.cookies))

    me = await client.user()
    expected = args.account.lstrip("@").lower()
    if me.screen_name.lower() != expected:
        return answer(
            ok=False,
            kind="unauthorized",
            message=f"the cookies are for @{me.screen_name}, not @{args.account.lstrip('@')}; nothing was posted",
        )
    if args.check:
        return answer(ok=True, user=me.screen_name)

    post = json.loads(sys.stdin.read() or "{}")
    text = post.get("text", "").strip()
    if not text:
        return answer(ok=False, kind="error", message="no text")

    media_ids = []
    if post.get("image"):
        try:
            media_ids = [await client.upload_media(post["image"], wait_for_completion=True)]
        except Exception as err:  # the post still goes out, without the image
            print(f"image upload failed: {err}", file=sys.stderr)

    tweet = await client.create_tweet(text=text, media_ids=media_ids or None)
    answer(ok=True, id=str(tweet.id), image=bool(media_ids))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cookies", default="cookies.json")
    parser.add_argument("--account", default="Storm__Central")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except DuplicateTweet as err:
        answer(ok=False, kind="duplicate", message=str(err))
    except TooManyRequests as err:
        answer(ok=False, kind="rate", message=str(err))
    except AccountLocked as err:
        answer(ok=False, kind="locked", message=str(err))
    except AccountSuspended as err:
        answer(ok=False, kind="suspended", message=str(err))
    except Unauthorized as err:
        answer(ok=False, kind="unauthorized", message=f"logged out or the cookies expired ({err})")
    except (CouldNotTweet, Forbidden) as err:
        # X's "this request looks like it might be automated" (code 226) means stop, not retry.
        automated = "automated" in str(err).lower() or "226" in str(err)
        answer(ok=False, kind="automated" if automated else "rejected", message=str(err))
    except FileNotFoundError:
        answer(ok=False, kind="unauthorized", message=f"no cookies file at {args.cookies}")
    except ValueError as err:
        answer(ok=False, kind="unauthorized", message=str(err))
    except Exception as err:
        answer(ok=False, kind="error", message=f"{type(err).__name__}: {err}")


if __name__ == "__main__":
    main()
