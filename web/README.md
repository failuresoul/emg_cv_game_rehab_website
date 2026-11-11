# MuVi Rehab web

React + TypeScript front end. Run every command below from `web/`. The dev server runs on port 5173 and proxies `/api` to the server on port 8000.

| Command          | Purpose                       |
| ---------------- | ----------------------------- |
| `npm install`    | Install dependencies          |
| `npm run dev`    | Start the dev server          |
| `npm run lint`   | Check the code with ESLint    |
| `npm run format` | Format the code with Prettier |
| `npm run build`  | Type-check and build          |

TypeScript is pinned to `~6.0` because `typescript-eslint` does not support newer versions yet.
