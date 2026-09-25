#!/usr/bin/env bash
# Council of the Damned worktree lifecycle. Runs under Git Bash on Windows and on Linux/macOS.
#
#   council-clean.sh create <repo> <slug> <depDir|none> <label> <base>
#       git worktree add --detach <base> at <repo>/../council-wt-<slug>-<label>
#       (label "review" → <repo>/../council-review-<slug>), then link <depDir> from the main checkout
#       (junction via mklink /J on Windows, ln -s elsewhere) and verify it. Prints the worktree path.
#   council-clean.sh clean  <repo> <slug> <depDir|none>
#       For every worktree of THIS slug only (council-wt-<slug>-<L>, council-wt-<slug>-<L>-scratch,
#       council-review-<slug>; never council-wt-<slug>-2-<L>): save refs/council/<slug>/<label>,
#       unlink <depDir> (rmdir / plain rm, never -r), STOP if the link survives, worktree remove --force,
#       prune, then verify <repo>/<depDir> still exists and is non-empty.
#   council-clean.sh apply  <repo> <slug> <depDir|none> <label> <base>
#       In that worktree: add -A, diff --cached --binary <base> to a patch file, apply --check then apply
#       in the main repo. Nothing is committed.
#
# Every failure prints a line starting "STOP:" and exits non-zero.
set -u

stop() { echo "STOP: $*" >&2; exit 1; }

verb=${1:-}; repo=${2:-}; slug=${3:-}; dep=${4:-none}
[ -n "$verb" ] && [ -n "$repo" ] && [ -n "$slug" ] || stop "usage: council-clean.sh <create|clean|apply> <repo> <slug> <depDir|none> [label base]"
[ "$dep" = none ] && dep=""
# slug and label are interpolated into case globs and ref names: no glob/ref metacharacters allowed
safe() { case "$2" in ''|*[!A-Za-z0-9._-]*) stop "$1 must match [A-Za-z0-9._-]: $2" ;; esac; }
safe slug "$slug"

case "$(uname -s)" in
  MINGW*|MSYS*) WIN=msys ;;
  CYGWIN*)      WIN=cygwin ;;
  *)            WIN="" ;;
esac
# cmd.exe needs backslash paths; under MSYS a bare /c is mangled into a path, so it is spelled //c there.
winpath() { cygpath -w "$1"; }
cmdc() { if [ "$WIN" = msys ]; then cmd //c "$@"; else cmd /c "$@"; fi; }

[ -n "$WIN" ] && repo=$(cygpath -u "$repo")
[ -d "$repo/.git" ] || git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || stop "not a git repository: $repo"
parent=$(cd "$repo/.." && pwd) || stop "cannot resolve parent of $repo"
wt_of() { if [ "$1" = review ]; then echo "$parent/council-review-$slug"; else echo "$parent/council-wt-$slug-$1"; fi; }

link_dep() {  # $1 = worktree
  [ -n "$dep" ] || return 0
  [ -d "$repo/$dep" ] || stop "dependency dir missing in main checkout: $repo/$dep"
  [ -e "$1/$dep" ] && stop "link target already exists: $1/$dep"
  if [ -n "$WIN" ]; then
    if [ "$WIN" = msys ]; then cmd //c mklink //J "$(winpath "$1/$dep")" "$(winpath "$repo/$dep")" >/dev/null
    else cmd /c mklink /J "$(winpath "$1/$dep")" "$(winpath "$repo/$dep")" >/dev/null; fi
  else
    ln -s "$repo/$dep" "$1/$dep"
  fi
  [ -e "$1/$dep" ] || stop "dependency link was not created: $1/$dep"
}

guard_links() {  # $1 = worktree; STOP if any junction/symlink in it still resolves into the main checkout
  # (worktree remove --force follows junctions: a link left behind would empty the real dependency dir)
  local main l t; main=$(norm "$repo")
  while IFS= read -r l; do
    t=$(norm "$l") || continue
    case "$t" in "$main"|"$main"/*) stop "link into the main checkout still present, not removing worktree: $l -> $t" ;; esac
  done < <(find "$1" -type l 2>/dev/null)
}
norm() { if [ -n "$WIN" ]; then cygpath -m "$(readlink -f "$1")"; else readlink -f "$1"; fi; }

unlink_dep() {  # $1 = worktree; removes only the link, never its contents
  [ -n "$dep" ] || return 0
  if [ -e "$1/$dep" ] || [ -L "$1/$dep" ]; then
    if [ -n "$WIN" ]; then cmdc rmdir "$(winpath "$1/$dep")"; else rm "$1/$dep"; fi
  fi
  if [ -e "$1/$dep" ] || [ -L "$1/$dep" ]; then stop "dependency link still present, not removing worktree: $1/$dep"; fi
}

case "$verb" in
create)
  label=${5:-}; base=${6:-}
  [ -n "$label" ] && [ -n "$base" ] || stop "create needs <label> <base>"
  safe label "$label"
  # only labels that clean's globs can match, so nothing is ever orphaned
  case "$label" in [A-J]|[A-J]-scratch|review) ;; *) stop "label must be A-J, <A-J>-scratch or review: $label";; esac
  wt=$(wt_of "$label")
  [ -e "$wt" ] && stop "worktree path already exists: $wt"
  [ -z "$dep" ] || [ -d "$repo/$dep" ] || stop "dependency dir missing in main checkout: $repo/$dep"
  git -C "$repo" rev-parse --verify -q "$base^{commit}" >/dev/null || stop "base $base is not a commit"
  out=$(git -C "$repo" worktree add --detach "$wt" "$base" 2>&1) || stop "git worktree add failed for $wt at $base: $out"
  link_dep "$wt"
  echo "created $wt"
  ;;
clean)
  removed=0
  # porcelain gives "worktree <path>" then "HEAD <sha>" per entry; only this slug's names match the globs
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt=${line#worktree } ;;
      "HEAD "*)
        sha=${line#HEAD }
        name=$(basename "$wt")
        case "$name" in
          council-wt-$slug-[A-J]) label=${name#council-wt-$slug-} ;;
          council-wt-$slug-[A-J]-scratch) label=${name#council-wt-$slug-} ;;
          council-review-$slug) label=review ;;
          *) continue ;;
        esac
        git -C "$repo" update-ref "refs/council/$slug/$label" "$sha" || stop "could not save refs/council/$slug/$label"
        unlink_dep "$wt"
        if [ -d "$wt" ]; then guard_links "$wt"; git -C "$repo" worktree remove --force "$wt" || stop "git worktree remove failed for $wt"; fi
        removed=$((removed + 1))
        echo "removed $wt (saved refs/council/$slug/$label)"
        ;;
    esac
  done < <(git -C "$repo" worktree list --porcelain)
  git -C "$repo" worktree prune
  if [ -n "$dep" ]; then
    [ -d "$repo/$dep" ] && [ -n "$(ls -A "$repo/$dep")" ] || stop "main checkout dependency dir is missing or empty after cleanup: $repo/$dep"
  fi
  echo "cleaned $removed worktree(s) for slug $slug"
  ;;
apply)
  label=${5:-}; base=${6:-}
  [ -n "$label" ] && [ -n "$base" ] || stop "apply needs <label> <base>"
  wt=$(wt_of "$label")
  [ -d "$wt" ] || stop "worktree missing: $wt"
  patch=$(mktemp "${TMPDIR:-/tmp}/council-$slug-$label.XXXXXX") || stop "mktemp failed"
  git -C "$wt" add -A || stop "git add -A failed in $wt"
  git -C "$wt" diff --cached --binary "$base" > "$patch" || stop "git diff failed in $wt"
  [ -s "$patch" ] || stop "empty diff against $base in $wt"
  git -C "$repo" apply --check "$patch" || stop "patch does not apply cleanly to $repo (patch kept at $patch)"
  git -C "$repo" apply "$patch" || stop "git apply failed (patch kept at $patch)"
  echo "applied $patch to $repo (uncommitted)"
  ;;
*)
  stop "unknown verb: $verb"
  ;;
esac
