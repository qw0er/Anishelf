# Desktop workspace

This workspace uses TypeScript for the Electron main process and Vite with
React and TypeScript for the standalone welcome page.

From the repository root, run `npm run dev:desktop` to build both parts and open
the page in Electron. Run `npm run start:desktop` to launch an existing build.

Set `ANISHELF_API_TARGET` to select the desktop server origin. It defaults to
`http://127.0.0.1:3000`. Use HTTPS for remote servers. HTTP is supported for
`localhost`, `127.0.0.1`, and `[::1]`. Specify only the origin, without a path,
query, fragment, or credentials.

```sh
ANISHELF_API_TARGET=https://anishelf.example.com npm run dev:desktop
```

To edit the page with Vite's live reload in a browser, run
`npm run dev:renderer --workspace @anishelf/desktop` and open the URL it prints.
