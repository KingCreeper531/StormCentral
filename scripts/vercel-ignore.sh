#!/usr/bin/env bash
# Vercel's "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the
# build, exit 1 builds. Skip it when a commit only touches things outside the
# web app (the other apps, servers, docs and CI); build when in doubt.
# Compared with the last deployment (VERCEL_GIT_PREVIOUS_SHA), so a push whose
# last commit is only docs still builds the app changes before it; when
# Vercel's shallow clone doesn't reach that commit, it builds.
if [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ]; then
  git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA^{commit}" 2>/dev/null || exit 1
  base=$VERCEL_GIT_PREVIOUS_SHA
else
  git rev-parse --verify --quiet HEAD^ >/dev/null || exit 1
  base=HEAD^
fi
git diff --quiet "$base" HEAD -- . \
  ':(exclude)shorts' \
  ':(exclude)website' \
  ':(exclude)docs' \
  ':(exclude)pro-server' \
  ':(exclude)android' \
  ':(exclude)desktop' \
  ':(exclude)store-assets' \
  ':(exclude)branding' \
  ':(exclude)stream' \
  ':(exclude)vps' \
  ':(exclude).github' \
  ':(exclude)*.md'
