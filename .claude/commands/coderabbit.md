---
description: Start a 4-minute loop that keeps the current PR's CodeRabbit review clean — addressing every CodeRabbit comment in-thread and resolving the thread.
argument-hint: [pr-number] [extra context or constraints]
---

Start a recurring **every-4-minutes** loop that drives the current PR's CodeRabbit review to clean. Each pass addresses every unresolved CodeRabbit comment, replies **IN THREAD** to that exact comment (never a new top-level PR comment), and resolves the thread.

Extra context from the user (may be empty): $ARGUMENTS

## Step 0 — Resolve the target PR (once)

- If `$1` is a number, target PR #$1. Otherwise resolve the current branch's PR: `gh pr view --json number,url,headRefName`.
- Capture `owner/repo`: `gh repo view --json nameWithOwner -q .nameWithOwner`.

## Step 1 — Start the loop

Invoke the **`loop`** skill now with:

- interval **`4m`**
- the looped prompt being the **Review pass** section below, verbatim, with `<owner>/<repo>` and `<N>` (the PR number) filled in.

Hand the loop the fully-resolved pass text — do **not** loop on `/coderabbit` itself (that would nest loops). The loop re-fires the same self-contained pass every 4 minutes until the stop condition is met.

---

## Review pass (one iteration — this is what the loop runs)

Review pass for PR **#\<N\>** in **\<owner\>/\<repo\>**. Only act on comments authored by `coderabbitai[bot]`.

1. **Fetch unresolved CodeRabbit threads** via GraphQL — these carry the resolution state the REST comments API doesn't:

    ```bash
    gh api graphql -f query='
      query($owner:String!,$repo:String!,$num:Int!){
        repository(owner:$owner,name:$repo){
          pullRequest(number:$num){
            reviewThreads(first:100){
              nodes{
                id isResolved isOutdated
                comments(first:50){ nodes{ databaseId author{login} body path line } }
              }
            }
          }
        }
      }' -F owner=<owner> -F repo=<repo> -F num=<N>
    ```

    Keep threads where `isResolved=false` and the first comment's `author.login = "coderabbitai[bot]"`.

2. **Address each unresolved thread:**
    - Legit finding → make the smallest correct fix. Tests first, per CLAUDE.md (colocated `*.test.ts`; integration test when live API / assistant behavior is involved). Type-check with `mcp__ide__getDiagnostics`.
    - False positive / won't-fix → note a one-line reason.
    - **Reply IN THREAD** to that specific comment using its `databaseId`:

        ```bash
        gh api -X POST repos/<owner>/<repo>/pulls/<N>/comments/<comment_databaseId>/replies \
          -f body="<what you changed, or why it's a non-issue>"
        ```

    - **Resolve the thread** (use the thread `id` from the query):

        ```bash
        gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -f id=<threadId>
        ```

3. **If code changed this pass:** run the relevant tests (`npm run test:grep -- "<suite>"`, then `npm run test:unit`), confirm zero diagnostics, commit with a normal-English message explaining the _why_, and `git push origin <branch>` so CodeRabbit re-reviews. (Sandbox org only for live tests; never delete data without asking.)

4. **Stop condition — end the loop when the PR is clean:** zero unresolved CodeRabbit threads **and** CodeRabbit has finished reviewing the latest pushed commit (`gh pr view <N> --json reviews,statusCheckRollup` shows no pending CodeRabbit run and no new comments). Report the PR URL and the threads addressed, and do **not** schedule another iteration. Otherwise, let the loop fire again in 4 minutes — CodeRabbit may post fresh comments after each push.

## Project rules (do not violate)

- Exploration uses the pre-approved read-only tools (`Read`/`Glob`/`Grep`/`Bash(git …)`/`mcp__ide__getDiagnostics`) — never `Bash(cat/grep/find)` for what those handle.
- Tests are mandatory for any code change; type-check via `mcp__ide__getDiagnostics`, not `tsc`.
- Push to `origin` (Jon's remote). Never push to the OwenIbarra review fork.
- Don't merge, tag, bump the version, or publish — releasing is CI-driven.
