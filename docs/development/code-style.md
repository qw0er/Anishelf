# Code Style

Follow the module boundaries in [Architecture](architecture.md). Apply these
constraints to new and changed code; avoid unrelated style rewrites.

- Use functions for stateless rules and transformations. Prefer classes for
  components that own mutable state or a lifecycle. Small closure-based factories
  are acceptable when their state and cleanup remain easy to follow.
- Use `createXxx()` factories for dependency assembly. Prefer composition over
  inheritance; do not introduce abstractions or forwarding layers without a
  concrete responsibility.
- Give each mutable state one owner. Pass collaborators the capabilities they
  need rather than an entire application context or configuration service.
- Keep business decisions, I/O orchestration and presentation distinct. Split
  code by responsibility, not arbitrary file or function length limits.
- Keep control flow explicit. Name complex conditions, prefer early returns, and
  avoid nested ternaries or collection chains that obscure side effects.
- Use descriptive business names and named options instead of multiple positional
  booleans. Define types at public boundaries; allow local type inference.
- Order class members as fields, constructor, public methods and private helpers.
  Keep related operations together.
- Use React function components. Extract components and hooks around cohesive UI
  or interaction responsibilities; avoid moving an entire large component into
  one large hook. Preserve query cancellation and invalidation behavior.
- Make errors, cancellation and cleanup explicit. Log meaningful state changes
  and failures at the responsible boundary without duplicating errors or exposing
  secrets. Comments should explain constraints and reasons, not restate code.
- Use Biome for formatting and linting. Preserve architecture and type checks,
  and validate affected behavior with relevant tests when refactoring.
