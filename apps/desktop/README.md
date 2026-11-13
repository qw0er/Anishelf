# Desktop workspace

This workspace uses TypeScript for the Electron main process and Vite with
React and TypeScript for the shared Anishelf interface.

From the repository root, run `npm run dev:desktop` to build both parts and open
the app in Electron. Run `npm run start:desktop` to launch an existing build.

Set `ANISHELF_API_TARGET` to select the desktop server origin. It defaults to
`http://127.0.0.1:3000`. Use HTTPS for remote servers. HTTP is supported for
`localhost`, `127.0.0.1`, and `[::1]`. Specify only the origin, without a path,
query, fragment, or credentials.

```sh
ANISHELF_API_TARGET=https://anishelf.example.com npm run dev:desktop
```

The desktop client uses the server's device sessions. Electron keeps the token
in the main process and uses the system credential store to encrypt it on disk.
When secure storage is unavailable, the session lasts until the app exits.

The desktop platform adapter uses Electron for clipboard writes, media downloads,
and opening links and external players. External player links support the IINA,
Infuse, mpv, VLC, and PotPlayer URL schemes. The player and its URL handler must
be installed on the system.

Start the server separately, then enter its password on the shared sign-in page.
