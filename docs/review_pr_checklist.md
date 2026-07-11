# Review PR Checklist

The branch URL is not the same as a real pull request URL.

Branch URL:

```text
https://github.com/foxian-aaron/careband-agent-demo/tree/codex/careband-real-demo
```

Expected real PR URL format:

```text
https://github.com/foxian-aaron/careband-agent-demo/pull/<number>
```

## Create The PR In GitHub UI (only with explicit user authorization)

1. Open `https://github.com/foxian-aaron/careband-agent-demo`.
2. Click `Compare & pull request` for `codex/careband-real-demo`.
3. Base branch: `main`.
4. Head branch: `codex/careband-real-demo`.
5. Title:

```text
feat: CareBand Agent v0.2 real demo loop
```

6. Paste `docs/pr_description.md`.
7. Create a draft PR if manual browser QA is still pending.

## Optional GitHub CLI Command

Only run this if `gh` is installed and authenticated:

```bash
gh pr create \
  --base main \
  --head codex/careband-real-demo \
  --title "feat: CareBand Agent v0.2 real demo loop" \
  --body-file docs/pr_description.md
```

## Before Requesting Review

- Original demo still works at the root GitHub Pages path.
- If a v0.2 static preview is deliberately deployed, its verified URL works; a source-branch push alone is not a deployment.
- The v0.2 banner clearly says GitHub Pages is a static preview using mock fallback.
- TEST001 displays team Apple Watch test data, not 陳伯.
- Unknown elder routes do not fallback to E001.
- E001 remains the main care-loop demo.
- v0.2 backend tests pass in CI.
- Docs do not claim the backend is hosted on GitHub Pages.
- Raw Apple Health files, `.env`, SQLite DB files, uploads, and `private_data/` are not staged.

## PR Description Sections

The PR body should include:

- Summary
- Public demo links
- Static preview caveat
- What changed
- How to run original demo
- How to run v0.2 frontend
- How to run v0.2 backend
- How to test
- Apple Health privacy notes
- TEST001 / E001 explanation
- Remaining risks
