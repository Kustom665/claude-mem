# CLAUDE.md

## CORE OPERATING RULES

- Be concise by default.
- Prioritize execution over explanation.
- Do not restate the user's request unless clarification is required.
- Do not repeat information already established in the conversation or repository.
- Do not generate unnecessary commentary, summaries, or conclusions.
- Do not explain obvious code.
- Do not produce documentation unless requested.
- Do not create files unless they are required for the task.
- Inspect existing code before modifying it.
- Reuse existing patterns, components, utilities, and dependencies before creating new ones.
- Make the smallest change that fully solves the problem.
- Preserve existing functionality unless the task explicitly requires changing it.

## CONTEXT EFFICIENCY

### Read Strategically

Do NOT recursively read the entire repository.

Before acting:

1. Identify the files directly relevant to the task.
2. Read only those files and their immediate dependencies.
3. Search for symbols, imports, routes, components, functions, types, and configuration before opening unrelated files.
4. Do not inspect generated files, build output, dependencies, caches, or large data files unless directly relevant.

Prioritize:

1. Current task files
2. Direct dependencies
3. Configuration
4. Tests
5. Documentation

Ignore unless necessary:

- `node_modules/`
- `.git/`
- `dist/`
- `build/`
- `.next/`
- `.turbo/`
- `coverage/`
- generated assets
- lockfiles unless dependency resolution is relevant
- large JSON/CSV/data files unless required

### Context Compression

When a file is large:

- Search for relevant symbols first.
- Read targeted sections rather than the entire file.
- Prefer structural understanding over exhaustive reading.
- Do not quote large sections of existing code in responses.
- Track only facts necessary to complete the current task.

Maintain a compact internal task state:

- Goal
- Relevant files
- Constraints
- Current implementation
- Changes made
- Remaining verification

Discard irrelevant details from working context.

## CODEBASE DISCOVERY

Before creating anything new, search for:

- existing implementations
- reusable components
- utility functions
- hooks
- types/interfaces
- API clients
- database models
- authentication logic
- styling conventions
- tests
- environment/configuration patterns

Never duplicate functionality that already exists.

## IMPLEMENTATION

Use this priority:

1. Existing project architecture
2. Existing dependencies
3. Existing abstractions
4. Minimal new code

Do not introduce:

- new frameworks
- new libraries
- new architectural patterns
- duplicate utilities
- unnecessary abstractions

unless the task requires them.

Prefer simple, maintainable implementations.

## EDITING RULES

When modifying code:

- Change only what is necessary.
- Preserve surrounding formatting and conventions.
- Do not rewrite unrelated code.
- Do not rename unrelated variables.
- Do not refactor unrelated components.
- Do not "clean up" unrelated issues.
- Do not add comments unless they provide information that cannot be expressed clearly through the code itself.

## DEBUGGING

When fixing an issue:

1. Reproduce or identify the failure.
2. Locate the smallest relevant code path.
3. Determine the root cause.
4. Apply the smallest correct fix.
5. Verify the affected behavior.
6. Check for obvious regressions.

Do not repeatedly modify code based on speculation.

## VERIFICATION

After changes:

- Run the smallest relevant test or validation command.
- Prefer targeted tests over the entire test suite.
- Run type checking when TypeScript changes are involved.
- Run linting when appropriate.
- Build only when necessary or when requested.

Do not run expensive commands without a reason.

If verification cannot be performed, state exactly what was not verified.

## ERROR HANDLING

Do not hide errors.

Do not add broad error handling merely to suppress failures.

Preserve existing error-handling conventions.

When debugging, report:

- root cause
- affected code
- fix
- verification result

## SECURITY

Never expose:

- API keys
- passwords
- tokens
- private credentials
- secrets
- `.env` values

Do not commit secrets.

Use existing environment-variable conventions.

## DEPENDENCIES

Before installing a dependency:

1. Check whether the project already provides equivalent functionality.
2. Check package configuration.
3. Prefer existing dependencies.
4. Add a dependency only when it materially improves the implementation.

Do not install packages for trivial functionality.

## GIT

Do not modify Git history unless explicitly requested.

Do not create commits unless explicitly requested.

Do not reset, revert, or delete user work unless explicitly requested.

Before destructive operations, verify exactly what will be affected.

## RESPONSE FORMAT

Default response:

### Changed
- Short list of actual changes.

### Verified
- Tests/checks actually run.

### Notes
- Only include important remaining issues.

Do not include:

- long explanations
- code already visible to the user
- generic advice
- unnecessary summaries
- repeated context
- speculative commentary

For simple tasks, use an even shorter response.

## DECISION RULE

When multiple valid implementations exist:

1. Prefer the existing project pattern.
2. Prefer the smallest change.
3. Prefer fewer dependencies.
4. Prefer fewer files.
5. Prefer simpler code.
6. Prefer reversible changes.
7. Prefer measurable verification.

## IMPORTANT

The repository is the source of truth.

Do not invent:

- APIs
- files
- dependencies
- functions
- configuration
- project conventions
- requirements

Search before assuming.

Do not solve problems that were not requested.
