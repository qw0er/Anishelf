# Desktop development

Run `npm run dev:desktop:all` from the repository root. It runs `npm run dev`
and `npm run dev:desktop` in parallel. Electron retries refused renderer
connections for up to 30 seconds while Vite starts. If either command exits,
the other stops. Ctrl+C also stops the stack.

Electron defaults to the shared Vite development address. To open only the
desktop window against another already running renderer:

```sh
ANISHELF_DESKTOP_URL=http://127.0.0.1:5180 npm run dev:desktop
```

The variable overrides the address Electron loads. It accepts HTTP(S) URLs
without embedded credentials. The desktop main process compiles automatically before
launch. Run `npm run build --workspace @anishelf/desktop` to compile it separately.

This is a development-only entry point. It does not yet package the application,
start the backend, or provide native desktop integrations.
