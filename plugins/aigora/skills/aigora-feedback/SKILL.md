---
name: aigora-feedback
description: Files feedback about Aigora — the Celo agent marketplace — as a pull request to the public trionlabs/aigora-skills repo, via an interactive walkthrough. Handles three feedback types (bug, feature request, general feedback), collects structured fields, drafts an entry, and opens the PR with gh (with a graceful fallback when gh isn't available). Use when the user wants to give feedback on Aigora, report an Aigora bug, request an Aigora feature, or submit to the Aigora hackathon feedback track. Keywords — Aigora feedback, report Aigora bug, Aigora feature request, Aigora idea, general feedback, hackathon feedback, submit feedback, Aigora marketplace, Celo agent marketplace.
---

# Aigora Feedback

Walk the user through giving feedback about Aigora, then open it as a **pull request** to [`trionlabs/aigora-skills`](https://github.com/trionlabs/aigora-skills) (the `feedback/` directory) — without making them touch GitHub's UI. The Aigora marketplace source is private, so feedback lands in this public repo as a reviewable PR; the PR link is the user's submission artifact.

The skill supports **three feedback types**, each mirroring a form template:

- **Bug** — something is broken or behaves unexpectedly. Template: `references/bug-form.md`.
- **Feature request** — an idea or capability you'd like Aigora to have. Template: `references/feature-form.md`.
- **General feedback** — impressions, friction, confusion, comparisons, praise — anything valuable that isn't a bug or a specific feature ask. Template: `references/other-feedback-form.md`.

Keep the questions, options, and required/optional split aligned with those template files. If they change, update the templates too.

## When to invoke

- "I want to give feedback on Aigora" / "report an Aigora bug" / "Aigora is broken"
- "I have an idea for Aigora" / "Aigora should support X"
- "General feedback on Aigora" / "my impressions of Aigora" / "submit to the Aigora feedback track"

Do **not** invoke for:

- Registering an agent on Aigora — that's the `aigora-register` skill.
- Security disclosures — those need a private channel. Tell the user to disclose privately (email / private advisory), not via a public PR.
- Feedback about an agent *built on* Aigora — that goes to that agent's own team.

## Flow

```
PICK TYPE → COLLECT FIELDS → DRAFT ENTRY → CONFIRM → PROBE gh → OPEN PR (fork if needed) | FALLBACK (save file + instructions) → OUTPUT PR URL
```

Run every step in order. Don't skip the confirmation step — this is a public repository, and a misfiled PR is awkward to clean up.

### Step 1 — Parse args

Recognise these inline flags if the user passes them:

| Flag             | Meaning                                                        |
|------------------|----------------------------------------------------------------|
| `--bug`          | Use the bug template, skip the type question                   |
| `--feature`      | Use the feature-request template, skip the type question       |
| `--other`        | Use the general-feedback template, skip the type question      |
| `--title TEXT`   | Pre-fill the one-line summary                                  |
| `--wallet TEXT`  | Pre-fill the CELO payout wallet address                        |
| `--profile TEXT` | Pre-fill the Aigora profile URL                                |
| `--contact TEXT` | Pre-fill the contact field                                     |

Anything not provided inline is asked interactively. Anything provided is treated as authoritative; do not re-prompt.

### Step 2 — Pick type

If no type flag was set, ask:

> Is this a **bug**, a **feature request**, or **general feedback**?

Single-choice. Don't assume a default.

### Step 3 — Collect fields

Read the matching template (`references/bug-form.md`, `references/feature-form.md`, or `references/other-feedback-form.md`) and ask each field in order. Rules:

- **Required fields** must be answered. If the user skips one, ask again.
- **Dropdowns** are presented as numbered options; the user picks a number or types the value.
- **Optional fields** can be skipped; render skipped fields as `_No response_`.
- **Multi-line fields** let the user paste freely. Do not summarise or rewrite their input — the maintainer judging feedback needs the user's own words.
- Every template shares a header block: **Contact** (**required** — an email address or Telegram @handle, used for prize follow-up; note it is public in the PR), **CELO payout wallet** (optional but needed to receive a hackathon prize), **Aigora profile URL** (optional; ties the feedback to a real registered agent), **Surface** (which part of Aigora), and **Network** (testnet or mainnet).

For **Network**, record the chain the user actually used, not one inferred from the event or website name. For on-chain activity, the profile's chain ID prefix or transaction explorer can help verify it; if it differs from the intended network, describe the mismatch. Do not guess. Ask for the app origin in **Steps to reproduce** for bugs, or **Anything else** for feature/general feedback: `aigora.org` and `aigora-prd.web.app` are separate builds.

For **Aigora profile URL**, copy the actual deployment's full URL with `/services/<chainId>_<lowercaseIdentityRegistryAddress>_<agentId>`; do not construct a numeric-only path. If the user supplies a numeric-only URL via `--profile`, flag the incomplete identity in the preview and keep their exact URL unless they correct it.

### Step 4 — Draft the entry

Compose the entry in markdown using the section structure from the relevant template. Section headings must match the template labels exactly.

- Title / summary: `[Feedback:<type>] <one-line summary>` (types: `bug`, `feature`, `general`). If the user didn't supply a one-line summary, ask for one — never auto-generate it.
- The entry will be committed as a new file: `feedback/<YYYYMMDD-HHMMSS>-<type>-<slug>.md`, where `<slug>` is a short kebab-case form of the summary. Get the timestamp from the shell (e.g. `date +%Y%m%d-%H%M%S`). One file per submission avoids merge conflicts.

### Step 5 — Confirm

Print the rendered title and entry body in full. Then ask:

> Open this as a pull request to `trionlabs/aigora-skills`?

If the user says no or wants to edit, loop back to the relevant field and re-ask. Do not open a PR without explicit confirmation.

### Step 6 — Probe `gh`

1. `command -v gh` — is the CLI installed?
2. If installed, `gh auth status --hostname github.com` — is the user authenticated **against github.com** specifically (a user authed only to a GitHub Enterprise host must not pass this check)?

If both succeed, take the happy path (Step 7). Otherwise, take the fallback (Step 8).

### Step 7 — Open the PR (happy path)

The user almost certainly does **not** have write access to `trionlabs/aigora-skills`, so the PR normally comes from their fork. Work through this carefully — the failure modes below are real.

1. **Check push access — and separate "no access" from "command errored":**

   ```bash
   push=$(gh api repos/trionlabs/aigora-skills --jq '.permissions.push' 2>/dev/null)
   status=$?
   ```

   Only treat `push == "true"` **and** `status == 0` as "I can push directly". If the command errored (`status != 0` — 404, rename, rate-limit), do **not** blindly fork; surface the error and stop, or retry. A missing/`false` value with `status == 0` means fork.

2. **Determine the fork slug — do not assume it's named `aigora-skills`.** Fork, then read back the *actual* fork's `nameWithOwner` (the user may already own a repo called `aigora-skills`, or GitHub may have renamed the fork on a collision):

   ```bash
   login=$(gh api user --jq '.login')
   gh repo fork trionlabs/aigora-skills --clone=false --remote=false   # idempotent
   fork=$(gh api repos/trionlabs/aigora-skills/forks --paginate \
            --jq ".[] | select(.owner.login==\"$login\") | .full_name" | head -n1)
   ```

   Use `$fork` (e.g. `alice/aigora-skills`) everywhere below — never a hardcoded name.

3. **Wait for the fork to be ready before cloning** (a just-created fork's git objects may not be replicated yet):

   ```bash
   for i in $(seq 1 15); do
     gh api "repos/$fork" --jq '.default_branch' >/dev/null 2>&1 && break
     sleep 2
   done
   ```

4. **Clone the fork into a temp dir, add the entry, push. Clean up the temp dir on exit** (it contains the user's contact/wallet — don't leave it on disk):

   ```bash
   tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
   gh repo clone "$fork" "$tmp" -- --depth=1       # (or trionlabs/aigora-skills if you had push access)
   branch="feedback/<type>-<slug>-<timestamp>"
   git -C "$tmp" checkout -b "$branch"
   mkdir -p "$tmp/feedback"
   # write the rendered entry to "$tmp/feedback/<YYYYMMDD-HHMMSS>-<type>-<slug>.md"
   git -C "$tmp" add feedback/
   git -C "$tmp" commit -m "feedback: <one-line summary>"
   git -C "$tmp" push -u origin "$branch"
   ```

5. **Create the PR against upstream — run it from inside the repo dir** (`gh pr create` has no `-C` flag and must run inside a git repo):

   ```bash
   ( cd "$tmp" && gh pr create \
       --repo trionlabs/aigora-skills \
       --base main \
       --head "$login:$branch" \
       --title "[Feedback:<type>] <summary>" \
       --body-file <rendered-entry-path> )
   ```

   (If you had direct push access, clone `trionlabs/aigora-skills` in step 4 and use `--head <branch>` without the `$login:` prefix.)

Notes:

- **Do not pass `--label`.** A PR opened from a fork can't set labels on the upstream repo, and the call will fail (403). The type is encoded in the title (`[Feedback:bug|feature|general]`) and in the entry body; maintainers label on triage.
- On success, print the **PR URL** plus a one-line summary of what was filed, and tell the user: *"Submit this PR link into the hackathon submission skill."* The feedback artifact is the `/pull/<number>` URL, including where event instructions call it a "Feedback Issue URL"; the optional agent profile URL is separate.

### Step 8 — Fallback (no `gh`)

The probe fails in one of two ways: `gh` is **missing entirely**, or `gh` is **installed but unauthenticated**. Offer to fix whichever applies — with explicit consent — and only fall through to save-and-instruct if the user declines.

**Never run a package install, `sudo`, or `gh auth login` without asking first in the same turn.** No silent escalation.

#### 8a — `gh` is missing

| Platform | Probe | Offer |
|----------|-------|-------|
| macOS + `brew` | `command -v brew` | `brew install gh` |
| Linux + apt / dnf / pacman | `command -v apt` etc. | Point at <https://github.com/cli/cli/blob/trunk/docs/install_linux.md> — don't auto-run (adds a GPG key + repo). |
| Windows | n/a | Print `winget install --id GitHub.cli` as text, don't auto-run. |
| macOS without `brew` | — | Print the release link <https://github.com/cli/cli/releases>. |

When an auto-run is on the table (macOS + `brew`), ask once:

> `gh` isn't installed. Run `brew install gh` now? (y/N)

Default is **no**. If yes, run it, then continue into 8c. If no, fall through to 8d.

#### 8b — `gh` is installed but unauthed

> `gh` is installed but not logged in. Run `gh auth login` now? It opens a browser. (y/N)

If yes, continue into 8c. If no, fall through to 8d.

#### 8c — Authenticate, then loop back

Run `gh auth login` interactively (surface that it opens a browser). On success, **loop back to Step 6** and continue into Step 7 with the entry we already drafted. Don't make the user re-answer anything.

#### 8d — Save-and-instruct fallback

1. Save the rendered entry to `./aigora-feedback-<timestamp>.md` in the user's current directory.
2. Print this hand-off, substituting the actual reason and path:

   > Couldn't open the PR via `gh` (`<reason>`). Your feedback is saved at `<path>`. To submit it manually: fork <https://github.com/trionlabs/aigora-skills>, add your saved file under `feedback/`, and open a pull request against `main`. Then submit its `https://github.com/trionlabs/aigora-skills/pull/<number>` link into the hackathon submission skill, including where event instructions call it a "Feedback Issue URL". The agent profile URL belongs in the entry's separate optional field.

3. If `gh` is missing, append: "If you'd rather use `gh` later, install it via <https://github.com/cli/cli#installation> and re-run this skill."
4. Exit. Do not poll for completion — the user finishes in the browser.

#### Hard rules for this step

- No `curl | sh`, no tarball-and-move-to-`/usr/local/bin`, no source builds. Package manager or release link — nothing in between.
- Don't `brew install gh` if `brew` isn't on PATH.
- Never escalate to `sudo` without prior consent in the same turn.

## Hard rules

- **Public repo.** Every PR is world-readable. Never include private keys, seed phrases, secrets, or internal URLs in the entry. A **wallet address** (for the CELO payout) is public and fine; a **private key or seed phrase is not** — if the user pastes one, redact it (`[redacted]`) and warn them before showing the preview.
- **No security disclosures via this skill.** If the user describes anything that sounds like a vulnerability (auth bypass, key leak, signature forgery, fund drain), stop and tell them to disclose privately rather than open a public PR.
- **Don't editorialise.** Use the user's wording. Judging "valuable feedback" needs the original signal.
- **One submission at a time.** If the user has two unrelated pieces of feedback, file them as separate PRs.

## See also

- `references/bug-form.md` — bug fields and entry template
- `references/feature-form.md` — feature-request fields and entry template
- `references/other-feedback-form.md` — general-feedback fields and entry template
- `aigora-register` skill — register your agent on Aigora and get a profile URL
