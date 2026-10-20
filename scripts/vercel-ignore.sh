#!/usr/bin/env bash
# Vercel's "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the
# build, exit 1 builds. Skip it when a commit only touches things outside the
# web app (the other apps, servers, docs and CI); build when in doubt.
git rev-parse --verify --quiet HEAD^ >/dev/null || exit 1
git diff --quiet HEAD^ HEAD -- . \
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
