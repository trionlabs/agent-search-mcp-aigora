# General feedback — fields and entry template

For impressions, friction, confusion, comparisons, or praise — anything valuable that isn't a specific bug or feature ask. This is where most "valuable feedback" lands.

## Metadata

- **Title prefix:** `[Feedback:general] `
- **File:** `feedback/<YYYYMMDD-HHMMSS>-general-<slug>.md`

## Shared header fields (all feedback types)

Ask these first, in order. `R` = required, `O` = optional.

| # | Field               | Type     | R/O | Notes                                                                     |
|---|---------------------|----------|-----|---------------------------------------------------------------------------|
| 1 | Contact             | Text     | R   | **Required** — an email address or Telegram @handle for prize follow-up (public in the PR).   |
| 2 | CELO payout wallet  | Text     | O   | Your Celo address for the hackathon prize. Address only — never a key.    |
| 3 | Aigora profile URL  | Text     | O   | Copy the actual deployment's full profile URL: `…/services/<chainId>_<lowercaseIdentityRegistryAddress>_<agentId>`, if registered. |
| 4 | Surface             | Dropdown | R   | Which part of Aigora your feedback is about — options below.              |
| 5 | Network             | Dropdown | R   | Which Celo network you used — options below.                             |

## General-feedback-specific fields

| # | Field              | Type      | R/O | Notes                                                                   |
|---|--------------------|-----------|-----|-------------------------------------------------------------------------|
| 6 | Your feedback      | Multiline | R   | What you experienced or think — in your own words.                       |
| 7 | Why it matters     | Multiline | R   | The impact: what it blocked, confused, delighted, or would change.       |
| 8 | Suggestion         | Multiline | O   | If you have one — what would make it better.                             |
| 9 | Anything else      | Multiline | O   | Screenshots (link), links, app origin you used, extra context.            |

### Surface options

1. Overall / first impression
2. Registration
3. Agent discovery / catalog
4. Agent profile page
5. Wallet / connection
6. Documentation
7. Other

### Network options

1. Testnet — Celo Sepolia (chainId `11142220`)
2. Mainnet — Celo (chainId `42220`)

## Entry body template

Keep headings verbatim. For skipped optional fields write `_No response_` on its own line.

```markdown
### Contact
{{contact}}

### CELO payout wallet
{{wallet or "_No response_"}}

### Aigora profile URL
{{profile or "_No response_"}}

### Surface
{{surface}}

### Network
{{network}}

### Your feedback
{{feedback}}

### Why it matters
{{impact}}

### Suggestion
{{suggestion or "_No response_"}}

### Anything else
{{extra or "_No response_"}}
```

A plain wallet address is fine to include; a private key or seed phrase is not — redact it and warn the user.
