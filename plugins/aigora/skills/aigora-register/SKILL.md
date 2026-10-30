---
name: aigora-register
description: Use when a builder wants to register, list, edit or migrate an owned ERC-8004 agent through Aigora's web app, update it from the CLI with the update_agent_intent MCP tool, or obtain its public profile URL. For generic on-chain ERC-8004 or x402 work, use the Celo agent-skills; for Aigora feedback, use aigora-feedback.
---

# Register or migrate your agent on Aigora

Guide the user through Aigora's web form and finish with a chain-qualified profile URL. The user connects their own external EOA wallet and approves transactions themselves. Handle no private keys, seed phrases or wallet signatures.

Read `references/registration-fields.md` before preparing fields or explaining validation. It defines the current source contract; deployed builds may lag. Confirm the selected deployment and network before signing:

- Celo Mainnet: chain ID **42220**.
- Celo Sepolia: chain ID **11142220**.

`https://aigora.org` and `https://aigora-prd.web.app` are separate builds. Do not assume their defaults, available actions or catalogs match. For event submissions, follow that event's network requirements; a Sepolia identity is not a Mainnet identity.

## Choose the correct flow

- **New identity:** use **Register agent**, which mints a token and then finalizes its metadata with a second transaction.
- **Existing owned identity on the selected canonical registry:** inspect **My Agents** first. For a foreign agent, use **Migrate to Aigora** when you want a clean metadata rebuild. Use **Edit**, where offered, to merge updates into the existing document while preserving unmanaged fields; Edit also emits `onAigora: true`. Both update the same token with one `setAgentURI`; they do not mint again or move reputation across chains.
- **Listed:** an indexed visibility status, not proof of Aigora participation or runtime readiness. A listed foreign agent can still offer migration.

If an existing identity is absent, check the deployment, chain, registry, owner and indexing state before suggesting another registration. If metadata cannot be loaded, stop the update and surface the error rather than publishing an empty replacement.

## Web flow

### 1. Check prerequisites

- The user controls the owner EOA wallet and has native CELO for gas on the chosen chain. New registration needs gas for two transactions; editing or migration needs one.
- If the selected chain is **Celo Sepolia (`11142220`)**, direct the user to the [Celo Sepolia faucet](https://faucet.celo.org/celo-sepolia) for native test CELO. It is listed in the [official Celo network documentation](https://docs.celo.org/build-on-celo/network-overview); availability and limits may change. Test CELO cannot fund Mainnet gas.
- The user has at least one service endpoint to publish. Recommend a publicly reachable HTTPS endpoint; private control endpoints are not suitable public listings.
- For paid services, the operator runs their own compatible x402 server. A display price alone does not enable payments. New registration records the connected owner wallet as `agentWallet`, the XMTP DM target. The operator runs that wallet's XMTP production inbox; registration does not provision the runtime.

### 2. Prepare the current form's fields

Use the reference's field table and validation rules. Required: name, a **50–1024 character** description and **1–7** typed service endpoints. Optional: profile/cover images, per-service version and **USDC display price**, x402 capability, categories, **up to 12 OASF skills**, **up to 8 OASF domains** and up to 8 external links.

Skills and domains come from fixed OASF lists. Help the user choose available selections; do not ask them to write free-text skills or skill descriptions. If a capability is absent, explain the gap rather than inventing a slug.

### 3. Connect and open the chosen action

Confirm the wallet account and network match the intended identity. Use the Agents network selector where available and check the wallet's chain too. **Sign in** authenticates the wallet; **Register agent** creates an agent identity. They are separate actions.

For a new identity, open **Register agent**. For editing or migration, open the owned record in **My Agents** and review the prefilled fields. Migration rebuilds metadata in Aigora's format and discards all fields the form does not manage; save the original document and review the replacement.

### 4. Validate before signing

Follow the reference's blocking rules. General service reachability/protocol verification is advisory; empty or oversized endpoints, duplicate rows and invalid versions/prices are still rejected. External links retain their public-HTTPS host checks.

**Accepts x402 payments** is a blocking exception: it requires a positive-price Web / REST endpoint and a compatible live x402 v2 challenge before signing and pinning. The check itself sends no payment signature. Resolve failures before asking the user to sign.

### 5. Submit and confirm

For **new registration**, tell the user to expect two wallet transaction prompts:

1. `register(...)` mints the canonical ERC-8004 agent token.
2. Aigora pins full metadata containing the new agent ID; `setAgentURI(agentId, …)` publishes that URI on-chain.

For **editing or migration**, approve one `setAgentURI` for the existing token. Review the account, chain, registry and transaction target before each signature. The user decides whether to sign.

If minting succeeds but finalization fails or is declined, use **Retry finalize identity** or edit that token later. This includes an x402 endpoint that passes the initial check but fails the pin-time check after minting. Do not start another registration to recover from an unfinished second step.

### 6. Verify the indexed profile

Transaction confirmation precedes indexing and metadata resolution. Use the full identity path:

```text
/services/<chainId>_<lowercaseIdentityRegistryAddress>_<agentId>
```

Copy the actual deployment's profile URL and check that its chain, registry, token, name and capabilities match the intended agent. A numeric-only `/services/407` does not identify the record. If the profile remains missing or incomplete, check transaction confirmation, finalization and indexing; do not promise that refreshing will resolve every failure.

## Catalog participation and follow-up

Canonical registry agents can be visible under **All** after indexing even if registered elsewhere. Aigora's builder emits top-level `onAigora: true`, a self-declared source label consumed by the indexer. It grants no verification, prize eligibility or trust privilege. See the reference for metadata placement and ownership rules.

For generic contract reads/writes or standalone x402 integration, use the [Celo agent-skills](https://github.com/celo-org/agent-skills) and [Celo ERC-8004 docs](https://docs.celo.org/build-on-celo/build-with-ai/8004). For runtime setup, consult the selected deployment's `/agent-operator-guide` if available. For an Aigora bug or feature request, use `aigora-feedback` to prepare a feedback pull request.

## Update from the CLI

An owner can update an existing agent without the browser through the aigora MCP tool `update_agent_intent`. The tool does not register new agents. It is available only where the deployed MCP server lists it; if `tools/list` lacks it, use web **Edit**.

1. **Set up signing once.** In their own Terminal, the user imports the agent owner's key into an encrypted Foundry keystore: `cast wallet import <name> --interactive`. Never ask for, read or paste a private key, seed phrase or keystore password. The keystore address must be the agent's on-chain owner (`ownerOf`), not only its `agentWallet`.
2. **Prepare the change.** Ask for the chain, agent ID, the owner's public address and the fields to change. The patch can change only `name`, `description`, `image`, `cover`, `services`, `skills`, `domains`, `categories` and `external_links`. An empty `image` or `cover` clears it. Skills and domains use the same fixed OASF lists as the form.
3. **Call the tool.** Call `update_agent_intent` with `chain_id`, `agent_id`, `owner_wallet` and `patch`. The server reads the current metadata on-chain and stops if it cannot load it. It merges the patch with the Edit rules, so fields Aigora does not manage are kept. It then validates the result, pins the new JSON to public IPFS and returns one unsigned `setAgentURI`. Before the call, tell the user that the new metadata becomes public on IPFS. If the merged metadata declares x402, the server first checks each priced web endpoint's live x402 challenge without paying, as the web form does; on failure it returns `x402_preflight_failed` (or `x402_probe_unavailable`) and pins nothing. Each caller gets one pin per agent every 5 minutes.
4. **Review.** Show `human_summary` and every entry in `changes` (before → after), plus `previous_uri` and `new_uri`. Get a clear yes.
5. **Sign.** Replace `<KEYSTORE_NAME>` in `sign_command` with the keystore name the user gave. The user runs that one `cast send` line in their own Terminal and enters the keystore password there. Do not run it for them.
6. **Verify.** Read `cast call <registry> "tokenURI(uint256)(string)" <agentId> --rpc-url <rpc>` and confirm it equals `new_uri`. Then open the chain-qualified profile URL as in step 6 of the web flow. Indexing can lag the transaction.

## Boundaries

- Guide the user; wallet transactions and payment approvals stay in their own wallet UI or Terminal.
- Keep secrets and private endpoints out of public metadata and feedback.
- Describe the observed deployment and form. Source support does not establish that a feature is already live there.
- This skill documents the web flow and the single-agent CLI update. It is not a bulk-registration API.
