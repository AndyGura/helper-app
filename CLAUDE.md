# Rules for agents on this repo

- This repo is PUBLIC and generic. Never add personal data: no names, no private/data repo names, no city or time zone defaults, no personal habits, health info or personal rules. Not in code, comments, prompts, docs or commit messages.
- Use placeholders (`owner/repo`, "the user") and config (app settings, env vars). Personal content lives in the user's private data repo.
- Pre-commit check: `git config core.hooksPath .githooks`. It blocks commits whose diff matches any line of `.private-words` (one regex per line, gitignored, never committed). Create that file locally from the private repo's rules before committing.
- Durable memory lives in repos, never only in session or project memory: generic rules and skills here, personal facts and procedures in the user's private data repo. Any agent session must be safe to delete and recreate with no loss.
