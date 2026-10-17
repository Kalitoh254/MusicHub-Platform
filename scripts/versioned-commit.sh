#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(git rev-parse --show-toplevel)"
[ "$#" -ge 1 ] || { echo 'Usage: scripts/versioned-commit.sh "Change description"'; exit 2; }
git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ] && { echo 'No changes to commit.'; exit 1; } || true
git check-ignore -q .env || { echo 'STOP: .env is not ignored.'; exit 1; }
if git ls-files --error-unmatch .env >/dev/null 2>&1; then echo 'STOP: .env is tracked.'; exit 1; fi
current=$(cat VERSION)
if [[ "$current" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  next="v${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((10#${BASH_REMATCH[3]} + 1))"
else
  echo 'Invalid VERSION format.'; exit 1
fi
printf '%s\n' "$next" > VERSION
git add -A
git commit -m "$next: $*"
git tag -a "$next" -m "MusicHub Platform $next"
git push origin HEAD
git push origin "$next"
