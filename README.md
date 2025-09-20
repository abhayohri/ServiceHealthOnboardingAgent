# Resource Health Onboarding Assistant (RHC)

VS Code extension that accelerates onboarding & maintenance of Azure Resource Health (RHC) assets: PolicyFiles & ResourceConfigs.

## Current Features
Core:
- Index policies (`PolicyFiles/PolicyFile_*.json`) and resource configs (`ResourceConfigs/**/ResourceConfig_*.json`).
- Heuristic validation (rules RHC001–RHC009) – fast, tolerant JSONC parsing & encoding handling.
- Tree View: Resource Types → Policies → Events.
- Scaffolding: create new resource type (policy + environment configs).
- Add Event command (append transient event JSON block).
- Compare Resource Configs (group by policy, show environment/region counts & health type).
- PR Checklist generation.
- Unreferenced policies report.
- Event search (substring) via command palette.

AI / Conversational (experimental):
- Chat participant `@rhc`.
	- Event discovery: "@rhc what are the possible events for virtual machines" (embedding-powered list).
	- Conversational scaffolding (multi-turn): "@rhc create a new resource type" → guided prompts → file generation with selected starter events.
	- Fast-path onboarding: "@rhc onboard resource type Contoso.Cache".
- Embedding index (local pseudo or Azure OpenAI stub) with documentation chunk ingestion (if enabled) – used for early RAG retrieval.

Resilience:
- Tolerant JSONC parsing (comments allowed, graceful warnings).
- Encoding heuristics (UTF-16 BOM detection, anomaly summarization, hex-first-byte diagnostics).

## Roadmap (Planned / Future)
- AJV schema validation with precise JSON range diagnostics.
- Rich semantic search & summarization (LLM integration when provider configured).
- Auto-fix / remediation suggestions for validation issues.
- Advanced resource coverage analysis (regions, environment parity).
- Intent expansion (diff explanation, event clustering, doc Q&A).
- Real Azure OpenAI embeddings (replace stub) & optional local model plugin point.

## Commands
- `RHC: Refresh Index` (`rhc.index.refresh`)
- `RHC: Validate Repository` (`rhc.validate.repository`)
- `RHC: Scaffold New Resource Type` (`rhc.scaffold.newResourceType`)
- `RHC: Add Event to Policy` (`rhc.scaffold.addEvent`)
- `RHC: Compare Resource Configs` (`rhc.compare.configs`)
- `RHC: Generate PR Checklist` (`rhc.pr.checklist`)
- `RHC: List Unreferenced Policies` (`rhc.find.unreferencedPolicies`)
- `RHC: Search Events` (`rhc.search.events`)
- `RHC AI: Rebuild Embedding Index` (`rhc.ai.rebuildEmbeddings`)

## Chat Usage Examples
```
@rhc what are the possible events for virtual machines
@rhc onboard resource type Contoso.Cache
@rhc create a new resource type
@rhc show VMUnavailable
@rhc throttling policy:Compute
```

Conversational scaffolding flow (when you omit the name):
1. "@rhc create a new resource type" → prompt for name.
2. Suggests baseline events (Unavailable, Degraded, ScheduledMaintenance).
3. You refine list (comma separated) or supply custom event IDs.
4. Confirm with `yes` → files generated.

## Settings (Extended)
Core:
- `rhc.scaffold.environments` (string[]) – environments to create configs for (default: ["Prod", "Int"]).
- `rhc.index.includeDocs` (boolean) – include `documentation/` folder chunks in embedding index.
- `rhc.ai.embeddingProvider` ("local-pseudo" | "azureOpenAI") – provider backend (Azure is stubbed until real call integrated).
- `rhc.ai.maxContextEvents` (number) – cap events returned for event discovery.

## Embeddings & RAG (Current Behavior)
- Local pseudo embeddings: deterministic hash → normalized vector (fast, offline, approximate semantics).
- Rebuild via `RHC AI: Rebuild Embedding Index` after adding/changing policies or docs.
- Documentation ingestion: each file in `documentation/` is chunked (≈800 chars) and embedded as `doc:` records.
- Event discovery selects top event vectors matching a resource type phrase.

## Extending / Customizing
To plug real Azure OpenAI embeddings later:
1. Implement REST call in `provider.ts` (replace stub embedder body).
2. Add secret management (environment variables or VS Code secret storage).
3. Optionally add rate limiting & caching layer.

## Development
Install dependencies and compile:
```bash
npm install
npm run build
```
Launch with F5 (Extension Development Host). Re-run embedding build after changes to policies or docs.

## Testing
Mocha test harness present (`src/test`). Current placeholder ensures green baseline. Future tests will cover:
- Index parsing resilience & encoding detection.
- Validation rule outputs.
- Embedding index integrity (record count & dims).
- Intent classification & scaffolding conversation transitions.

## Security & Privacy (Early Stage)
- No external calls when `rhc.ai.embeddingProvider = local-pseudo` and `rhc.ai.llmProvider = none`.
- When remote providers are introduced, only minimal text fragments (events/doc chunks) will be sent.
- Avoid placing secrets in PolicyFiles / ResourceConfigs (not redacted automatically yet).

## Limitations
- Validation is heuristic; schema enforcement pending.
- Embedding relevance is approximate until real model integration.
- Conversational scaffolding currently single-session and not persisted across reload.

## Contributing / Roadmap
Open issues or propose enhancements (semantic diff explanations, fix suggestions, additional intent types). Modular AI layer enables gradual upgrade to real semantic + LLM summarization.

---
*Early-stage implementation – interfaces may change prior to stabilization.*
