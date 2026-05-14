---
name: git-commit
description: Summarizes the current conversation and commits all modified files. Does not push.
allowed-tools: Bash(git add *), Bash(git commit *), Bash(git diff *), Bash(git status *), Bash(git log *)
---

## Current git state

### Modified files
!`git status --short`

### Staged and unstaged diff
!`git diff HEAD`

### Recent commits (for message style reference)
!`git log --oneline -5`

## Instructions

1. Review the diff and modified files shown above.
2. Review the full conversation history in context to understand what work was done and why.
3. Write a commit message that:
   - Has a subject line under 72 characters summarizing the change
   - If exactly one file was modified, include the file name (e.g. `SKILL.md`, `trains.yaml`) at the start of the subject line, followed by a colon and the summary
   - Follows the style of recent commits shown above
   - Always includes a body with the full details: what changed, why it was done, and any relevant context from the conversation — even if the subject line is self-explanatory
4. Present the proposed commit message to the user and ask for confirmation before proceeding. Wait for explicit approval (e.g. "yes", "ok", "go ahead") or a corrected message. If the user rejects or edits it, update accordingly and ask again.
5. Once confirmed, stage all modified and untracked files relevant to the work: `git add -A` (but skip .env, secrets, or credential files if any are present)
6. Commit using this exact format:
   ```
   git commit -m "$(cat <<'EOF'
   <subject line>

   <optional body>
   EOF
   )"
   ```
7. Show the result of `git status` and `git log --oneline -3` after committing.
8. Do NOT run `git push`.
