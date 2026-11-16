# Issue tracker: Local Markdown

Issues and specs live as Markdown files under `.scratch/`.

- One feature per directory: `.scratch/<feature-slug>/`
- Spec: `.scratch/<feature-slug>/spec.md`
- Each implementation issue is a separate numbered file under `.scratch/<feature-slug>/issues/`, starting at `01`.
- Put a `Status:` line near the top of each issue.
- Append discussion under `## Comments`.
- A wayfinding map lives at `.scratch/<effort>/map.md`; child tickets live under its `issues/` directory and use `Type:`, `Status:`, and `Blocked by:` lines.
