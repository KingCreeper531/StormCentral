# Storm Central: notes for Claude Code

## Verify facts before they leave the repo

Before stating anything about Storm Central to someone outside (emails, store listings, release notes, PR descriptions, posts), check it against the code or the live site. Don't paraphrase marketing copy: "no account needed" doesn't mean "no accounts". Accounts exist for the spotter network and settings sync, and they're optional. If a fact can't be checked, leave it out or say it's unverified.

## Links in emails

People must see the real address (https://www.stormcentralwx.com), not a redirect. The Gmail connector rewrites every link in a message it sends or drafts into a `https://www.google.com/url?q=…` redirect: plain text, `<a href>` and bare domains alike (tested October 2026). So for an email that needs a link, write the text and give it to the user to send from Gmail themselves; send through the connector only when the email has no links.

## YouTube titles

No emojis in titles (no red dots either): the stream's automatic titles, the Shorts and anything suggested to the user. `stream/plan.test.ts` checks the stream's titles for any.
