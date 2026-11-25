# Buffalo — SD-AI fork documentation

A static documentation site for the independent [Buffalo fork](https://github.com/yudocyudoc/buffalo-01), published at [https://yudocyudoc.github.io/buffalo-01/](https://yudocyudoc.github.io/buffalo-01/).

Buffalo is an independently maintained fork of SD-AI that aims to run the original engines, agents and application code on alternative infrastructure, with durable project state and continuity across sessions and restarts. The initial implementation targets Cloudflare; the goal is portability while preserving upstream behavior and minimizing changes to the original code.

The original project is [UB-IAD/sd-ai](https://github.com/UB-IAD/sd-ai), developed at the University at Buffalo, with its [own documentation](https://ub-iad.github.io/sd-ai/). This fork does not claim affiliation, funding, sponsorship or endorsement by upstream or its partners. Inherited leaderboard data is not independently reproduced Buffalo benchmark evidence. The original MIT license and copyright remain intact. Runtime implementation and validation are described in [the runtime README](../infra/full-runtime/README.md).

## What this is

- A **frontend-only** React single page application living in the `frontend/`
  folder, with its own dependencies and `package.json` separate from the rest
  of the `sd-ai` project.
- It is a **pure static documentation site**: it has **no backend and no
  engine-testing capability**. It does not call the `sd-ai` API at runtime.
- Instead, a build step introspects the repository and generates the data the
  site renders. The site documents:
  - **Engines** — every engine in `engines/`, with a toggle to reveal `test-`
    engines. Each engine page shows its description, supported modes, reference
    link, source, and full parameter schema.
  - **Agents** — the conversational modeling assistants whose configs are
    checked into `agent/config/` (Merlin, Athena, Socrates and Themis today;
    the two Athena phase files are merged into one entry). Each shows its
    metadata and full system prompt.
  - **Evaluations** — every eval category in `evals/categories/`, grouped by
    the leaderboard it is scored on (Stock & Flow, Causal Loop Diagrams,
    Discussion, Agents), down to each individual test's prompt, inputs and
    expectations. Agent categories also show their role (regression guard or
    discriminating) and what each group holds (dev, held out, hard), and a
    separate page, `#/evals/agents`, explains how the agent evals are run and
    graded.
  - **Leaderboards** — per-mode benchmark results, pre-aggregated at build time
    from the gzipped board files in `evals/results/`. A board with no results
    file yet (the `agent` board until its first run is collected) still shows
    its columns, with a "not published yet" notice.

## How the data is generated

`scripts/generateData.mjs` runs before every `dev`/`build`. It imports the
engine/eval/agent modules directly from the repo root and calls the same
methods the backend routes use (`supportedModes()`, `description()`, `link()`,
`additionalParameters()`, `AgentConfigurationManager.parseContent()`, …),
writing JSON into `src/generated/` (which is git-ignored and regenerated on
every build). The React pages import that JSON statically — there is no
runtime API client.

The leaderboard boards in `evals/results/` are stored gzipped (`.json.gz`,
~19 MB rather than ~95 MB) and are read through `evals/leaderboardFile.js`, the
same helper the backend route uses. That is a detail of the generator only: it
aggregates each board down to the small `leaderboards.json` the pages import, so
the React side never sees a raw results file, compressed or not.

Because the generator imports modules from the repo root, the **root**
dependencies must be installed (`npm ci` at the repo root) in addition to the
frontend dependencies.

Agents are discovered from **git-tracked** files in `agent/config/` only, so
untracked/experimental configs never appear in the docs.

What each leaderboard column means, and which board a category is listed under
on the Evaluations page, both come from `src/pages/leaderboardMeta.js`: a new
category needs a line in its board's `categoryNotes` there. Text that applies to
the agent evals as a whole lives in `src/pages/AgentEvalsGuide.jsx`; the
per-category text comes from each category's own `description()` and
`methodology()`.

## Development

```bash
# from the repo root, once, so the generator can import engine/agent/eval modules
npm ci

# then, in this folder
cd frontend
npm install
npm run dev        # runs the generator, then vite dev
```

The app will be available at `http://localhost:5173/sd-ai/`.

Useful scripts:
- `npm run generate` — regenerate `src/generated/*.json` only.
- `npm run build` — regenerate data, then produce a production build in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run lint` — run ESLint.

## Deployment

The site deploys automatically to **GitHub Pages** via GitHub Actions
(`.github/workflows/deploy-pages.yml`) on every push to `main`. The workflow
installs root + frontend dependencies, runs `npm run build`, and publishes
`frontend/dist`.

**One-time repo setup:** in the repository's **Settings → Pages**, set
**Source** to **"GitHub Actions"**. No manual `gh-pages` step is needed.

The deployment reads the actual site base path from `actions/configure-pages` and passes it to Vite as `PAGES_BASE_PATH` (including an empty value for root/custom-domain sites). Upstream uses `/sd-ai/`; the Buffalo fork uses `/buffalo-01/` when configured as a project page. Local development retains the upstream default unless the variable is set. Routing uses `HashRouter`, so no server-side rewrite is needed. PRs changing the frontend or workflow build and verify generated index asset paths without deploying; push/manual builds use the configured Pages path. Documentation links identifying upstream remain upstream links. The static documentation site is not the Buffalo runtime UI.
