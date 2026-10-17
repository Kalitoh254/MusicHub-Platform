# MusicHub Platform Versioning

The deployed baseline is v0.01.1.

Every subsequent project commit must have a unique version number:
- Increment the final number for each commit: v0.01.2, v0.01.3, v0.01.4.
- Reserve middle-number increments for deliberate milestone releases.
- Reserve first-number increments for major platform releases.
- Every versioned commit must have a matching annotated Git tag.
- Push the commit and its tag to origin.
- Use scripts/versioned-commit.sh for routine commits.
- Never commit .env, credentials, or private keys.
