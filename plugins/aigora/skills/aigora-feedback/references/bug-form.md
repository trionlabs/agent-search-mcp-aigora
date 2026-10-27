# Bug — fields and entry template

For reporting something broken or behaving unexpectedly in Aigora.

## Metadata

- **Title prefix:** `[Feedback:bug] `
- **File:** `feedback/<YYYYMMDD-HHMMSS>-bug-<slug>.md`

## Shared header fields (all feedback types)

Ask these first, in order. `R` = required, `O` = optional.

| # | Field               | Type     | R/O | Notes                                                                     |
|---|---------------------|----------|-----|---------------------------------------------------------------------------|
| 1 | Contact             | Text     | R   | **Required** — an email address or Telegram @handle for prize follow-up (public in the PR).   |
| 2 | CELO payout wallet  | Text     | O   | Your Celo address for the hackathon prize. Address only — never a key.    |
| 3 | Aigora profile URL  | Text     | O   | Copy the actual deployment's full profile URL: `…/services/<chainId>_<lowercaseIdentityRegistryAddress>_<agentId>`, if registered. |
| 4 | Surface             | Dropdown | R   | Which part of Aigora — options below.                                     |
| 5 | Network             | Dropdown | R   | Which Celo network you used — options below.                             |

## Bug-specific fields

| # | Field                    | Type      | R/O | Notes                                             |
|---|--------------------------|-----------|-----|---------------------------------------------------|
| 6 | What happened?           | Multiline | R   | What you did, what you expected, what you saw.     |
| 7 | Steps to reproduce       | Multiline | R   | Minimal steps someone else could follow; include the app origin you used. |
| 8 | Logs / console output    | Multiline | O   | Wrap in a ```` ```shell ```` block when provided.  |
| 9 | Transaction / agent ID   | Text      | O   | Tx hash or agent/service id, if one is involved.   |
| 10| Anything else            | Multiline | O   | Screenshots (link), recordings, extra context.     |

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

Keep headings verbatim. For skipped optional fields write `_No response_` on its own line. For **Logs**: if provided, wrap in a shell fence; if skipped, write `_No response_` with **no** fence.

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

### What happened?
{{what-happened}}

### Steps to reproduce
{{repro}}

### Logs / console output
{{
  if logs provided:
    ```shell
    {{logs}}
    ```
  else:
    _No response_
}}

### Transaction / agent ID
{{tx or "_No response_"}}

### Anything else
{{extra or "_No response_"}}
```

If the user pastes anything that looks like a private key or seed phrase, **redact it** (`[redacted]`) in the rendered entry and warn them before showing the preview. A plain wallet address is fine.
