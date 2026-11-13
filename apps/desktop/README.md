# Desktop workspace

This workspace uses TypeScript for the Electron main process and Vite with
React and TypeScript for the standalone welcome page.

From the repository root, run `npm run dev:desktop` to build both parts and open
the page in Electron. Run `npm run start:desktop` to launch an existing build.

To edit the page with Vite's live reload in a browser, run
`npm run dev:renderer --workspace @anishelf/desktop` and open the URL it prints.
