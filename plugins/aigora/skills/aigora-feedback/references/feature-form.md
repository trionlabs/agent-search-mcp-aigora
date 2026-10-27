# Feature request — fields and entry template

For an idea or capability you'd like Aigora to have.

## Metadata

- **Title prefix:** `[Feedback:feature] `
- **File:** `feedback/<YYYYMMDD-HHMMSS>-feature-<slug>.md`

## Shared header fields (all feedback types)

Ask these first, in order. `R` = required, `O` = optional.

| # | Field               | Type     | R/O | Notes                                                                     |
|---|---------------------|----------|-----|---------------------------------------------------------------------------|
| 1 | Contact             | Text     | R   | **Required** — an email address or Telegram @handle for prize follow-up (public in the PR).   |
| 2 | CELO payout wallet  | Text     | O   | Your Celo address for the hackathon prize. Address only — never a key.    |
| 3 | Aigora profile URL  | Text     | O   | Copy the actual deployment's full profile URL: `…/services/<chainId>_<lowercaseIdentityRegistryAddress>_<agentId>`, if registered. |
| 4 | Surface             | Dropdown | R   | Which part of Aigora the idea concerns — options below.                   |
| 5 | Network             | Dropdown | R   | Which Celo network you used — options below.                             |

## Feature-specific fields

| # | Field                 | Type      | R/O | Notes                                                          |
|---|-----------------------|-----------|-----|----------------------------------------------------------------|
| 6 | Problem / motivation  | Multiline | R   | What are you trying to do that Aigora makes hard today?        |
| 7 | Proposed feature      | Multiline | R   | What you'd like Aigora to do.                                  |
| 8 | Alternatives          | Multiline | O   | Workarounds or other approaches you considered.                |
| 9 | Anything else         | Multiline | O   | Mockups (link), references, app origin you used, extra context. |

### Surface options

1. Registration
2. Agent discovery / catalog
3. Agent profile page
4. Wallet / connection
5. Documentation
6. Other

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

### Problem / motivation
{{motivation}}

### Proposed feature
{{proposal}}

### Alternatives
{{alternatives or "_No response_"}}

### Anything else
{{extra or "_No response_"}}
```

A plain wallet address is fine to include; a private key or seed phrase is not — redact it and warn the user.
