# Git identity

The repository is https://github.com/blondak/prusament2spoolman.

All commits for this project must use this identity for both author and committer:

- Name: `Blonďák`
- Email: `blondak@neser.cz`

Before creating commits, configure `user.name` and `user.email` locally in this
repository (never change the global Git configuration). Verify the effective
identity with `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT`.
If environment overrides disagree, explicitly set the author and committer
name/email for the commit invocation. Verify the resulting commit metadata.
