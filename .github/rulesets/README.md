# GitHub branch rulesets

These files are repository rulesets for the secondary-development branch policy. GitHub does not activate ruleset files from the repository tree automatically; a repository administrator must import both files under **Settings > Rules > Rulesets > New ruleset > Import a ruleset**.

## `main`

Import [`main-pull-request-only.json`](main-pull-request-only.json). It blocks deletion and force pushes and requires every change to reach `main` through a pull request. The ruleset requires no approval by itself; repository owners may raise `required_approving_review_count` without changing the direct-push restriction.

Do not add bypass actors. A bypass actor could push directly or merge without satisfying the pull-request rule, depending on its bypass mode.

## `master`

Import [`master-upstream-sync-only.json`](master-upstream-sync-only.json). It blocks deletion, force pushes, and ordinary updates while allowing GitHub's fetch-and-merge operation from the fork's upstream repository.

This exception works only when GitHub recognizes the repository as a fork and `master` has a corresponding upstream branch. Do not add bypass actors; a user, team, role, app, or deploy key with an `always` bypass could change `master` outside upstream synchronization.

Automated synchronization must call GitHub's `POST /repos/{owner}/{repo}/merge-upstream` endpoint with `branch` set to `master`. A workflow that fetches upstream locally and runs `git push origin HEAD:master` performs an ordinary update and remains blocked by this ruleset.
