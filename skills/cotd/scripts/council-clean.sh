#!/usr/bin/env bash
# Council of the Damned worktree lifecycle. Runs under Git Bash on Windows and on Linux/macOS.
#
#   council-clean.sh create <repo> <slug> <depDir|none> <label> <base>
#       git worktree add --detach <base> at <repo>/../council-wt-<slug>-<label>
#       (label "review" → <repo>/../council-review-<slug>), then link <depDir> from the main checkout
#       (junction via mklink /J on Windows, ln -s elsewhere) and verify it. Prints the worktree path.
#   council-clean.sh clean  <repo> <slug> <depDir|none>
#       For every worktree of THIS slug only (council-wt-<slug>-<L>, council-wt-<slug>-<L>-scratch,
#       council-review-<slug>; never council-wt-<slug>-2-<L>): save refs/council/<slug>/<label> (a snapshot
#       of the worktree including uncommitted work; kept as is when save-refs already stored that tree),
#       unlink <depDir> (rmdir / plain rm, never -r), STOP if the link survives, worktree remove --force,
#       prune, then verify <repo>/<depDir> still exists and is non-empty.
#   council-clean.sh apply  <repo> <slug> <depDir|none> <label> <base> [ref]
#       In that worktree: add -A, diff --cached --binary <base> to a patch file, apply --check then apply
#       in the main repo. Nothing is committed. With "ref" the source is refs/council/<slug>/<label>
#       instead (base "auto" = refs/council-wip/<slug> when the ref was built on it, else merge-base HEAD <ref>);
#       it refuses only when the patch touches a path that is dirty in the main repo (changed against HEAD, or
#       against the wip snapshot for a wip run), and says when the latest ledger line names another winner.
#   council-clean.sh wip-snapshot <repo> <slug>
#       Snapshot the dirty tree (staged, unstaged, untracked) through a temporary index: write-tree,
#       commit-tree -p HEAD, update-ref refs/council-wip/<slug>. HEAD, branch and the real index are
#       untouched. Prints the snapshot sha (the run's base).
#   council-clean.sh save-refs <repo> <slug> <depDir|none> <base>
#       For every worktree of this slug: add -A, write-tree, commit-tree -p <base>, update-ref
#       refs/council/<slug>/<label>. Removes nothing.
#   council-clean.sh runs <repo> [slug]
#       List saved refs/council/<slug>/<label> refs with git diff --stat against their base.
#   council-clean.sh stats
#       Summarize the last 500 lines of <config dir>/council-ledger.jsonl per model:effort and per mode.
#   council-clean.sh doctor <repo>
#       Read-only checks: git >= 2.5, no CR in workflows/*.js, stale council worktrees and dangling links.
#
# Every failure prints a line starting "STOP:" and exits non-zero.
set -u

stop() { echo "STOP: $*" >&2; exit 1; }

# ledger-append <ledgerPath> <lineFile>: append one JSON line to the run ledger, creating its directory
if [ "${1:-}" = ledger-append ]; then
  path=${2:-}; linefile=${3:-}
  [ -n "$path" ] && [ -n "$linefile" ] || stop "usage: council-clean.sh ledger-append <ledgerPath> <lineFile>"
  [ -f "$linefile" ] || stop "line file missing: $linefile"
  mkdir -p "$(dirname "$path")" || stop "cannot create ledger directory"
  cat "$linefile" >> "$path" || stop "append to $path failed"
  echo "ledger-append -> $path"
  exit 0
fi
verb=${1:-}; repo=${2:-}; slug=${3:-}; dep=${4:-none}
here=$(cd "$(dirname "$0")" && pwd)
case "$verb" in
  stats) ;;
  runs|doctor) [ -n "$repo" ] || stop "usage: council-clean.sh $verb <repo>" ;;
  *) [ -n "$verb" ] && [ -n "$repo" ] && [ -n "$slug" ] || stop "usage: council-clean.sh <create|clean|apply|wip-snapshot|save-refs|runs|stats|doctor> <repo> <slug> <depDir|none> [label base]" ;;
esac
[ "$dep" = none ] && dep=""
# slug and label are interpolated into case globs and ref names: no glob/ref metacharacters allowed
safe() { case "$2" in ''|*[!A-Za-z0-9._-]*) stop "$1 must match [A-Za-z0-9._-]: $2" ;; esac; }
[ -n "$slug" ] && safe slug "$slug"

case "$(uname -s)" in
  MINGW*|MSYS*) WIN=msys ;;
  CYGWIN*)      WIN=cygwin ;;
  *)            WIN="" ;;
esac
# cmd.exe needs backslash paths; under MSYS a bare /c is mangled into a path, so it is spelled //c there.
winpath() { cygpath -w "$1"; }
cmdc() { if [ "$WIN" = msys ]; then cmd //c "$@"; else cmd /c "$@"; fi; }
# commit-tree needs an identity; a repo with none configured must not STOP
export GIT_AUTHOR_NAME=${GIT_AUTHOR_NAME:-council} GIT_AUTHOR_EMAIL=${GIT_AUTHOR_EMAIL:-council@localhost} GIT_COMMITTER_NAME=${GIT_COMMITTER_NAME:-council} GIT_COMMITTER_EMAIL=${GIT_COMMITTER_EMAIL:-council@localhost}
ledger_file() { local d=${CLAUDE_CONFIG_DIR:-$HOME/.claude}; [ -n "$WIN" ] && d=$(cygpath -u "$d"); echo "$d/council-ledger.jsonl"; }

if [ "$verb" = stats ]; then
  f=$(ledger_file)
  [ -s "$f" ] || { echo "no ledger at $f"; exit 0; }
  echo "ledger $f (last $(tail -n 500 "$f" | wc -l | tr -d ' ') runs)"
  # fates are written by the workflow scripts as {"seat":"<model:effort>","label":"<L>","fate":"<fate>"}
  tail -n 500 "$f" | awk '
    { mode = "?"; if (match($0, /"mode":"[^"]*"/)) mode = substr($0, RSTART + 8, RLENGTH - 9)
      runs[mode]++; s = $0
      while (match(s, /\{[^{}]*"fate":"[^{}]*\}/)) {   # one seat object, keys in any order
        o = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH)
        if (!match(o, /"seat":"[^"]*"/)) continue; st = substr(o, RSTART + 8, RLENGTH - 9)
        match(o, /"fate":"[^"]*"/); k = substr(o, RSTART + 8, RLENGTH - 9); sub(/:.*/, "", k)
        seat[st]++; n[st, k]++; m[mode, k]++
      } }
    END {
      for (x in seat) printf "1 %s %d %d %d %d %d %d %d\n", x, seat[x], n[x,"won"], n[x,"ranked"], n[x,"eliminated"], n[x,"doa"], n[x,"died"], n[x,"unranked"]
      for (x in runs) printf "2 %s %d %d %d %d %d %d %d\n", x, runs[x], m[x,"won"], m[x,"ranked"], m[x,"eliminated"], m[x,"doa"], m[x,"died"], m[x,"unranked"] }' |
    sort | awk '$1 != sec { sec = $1; printf "%-16s %6s %4s %6s %10s %4s %4s %8s\n", (sec == 1 ? "seat" : "mode"), (sec == 1 ? "seated" : "runs"), "won", "ranked", "eliminated", "doa", "died", "unranked" }
      { printf "%-16s %6s %4s %6s %10s %4s %4s %8s\n", $2, $3, $4, $5, $6, $7, $8, $9 }'
  exit 0
fi

[ -n "$WIN" ] && repo=$(cygpath -u "$repo")
[ -d "$repo/.git" ] || git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || stop "not a git repository: $repo"
parent=$(cd "$repo/.." && pwd) || stop "cannot resolve parent of $repo"
wt_of() { if [ "$1" = review ]; then echo "$parent/council-review-$slug"; else echo "$parent/council-wt-$slug-$1"; fi; }

slug_wts() {  # prints "<label> <HEAD sha> <path>" for every worktree of THIS slug only
  local line wt="" name
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) wt=${line#worktree } ;;
      "HEAD "*)
        name=$(basename "$wt")
        case "$name" in
          council-wt-$slug-[A-J]|council-wt-$slug-[A-J]-scratch) echo "${name#council-wt-$slug-} ${line#HEAD } $wt" ;;
          council-review-$slug) echo "review ${line#HEAD } $wt" ;;
        esac ;;
    esac
  done < <(git -C "$repo" worktree list --porcelain)
}
wip_tree() {  # the whole working tree (staged, unstaged, untracked) as a tree sha, via a copy of the real index
  local idx real gidx tree
  idx=$(mktemp "${TMPDIR:-/tmp}/council-wip-index.XXXXXX") || stop "mktemp failed"
  real=$(git -C "$repo" rev-parse --git-path index)
  case "$real" in /*|?:*) ;; *) real="$repo/$real" ;; esac
  # a copy of the real index keeps tracked-but-ignored files; an empty file is not a valid index
  if [ -f "$real" ]; then cp -p "$real" "$idx"; else rm -f "$idx"; fi  # -p keeps the index mtime so racy-index re-hashing still fires
  gidx=$idx; [ -n "$WIN" ] && gidx=$(cygpath -m "$idx")
  GIT_INDEX_FILE="$gidx" git -C "$repo" -c core.safecrlf=false add -A || { rm -f "$idx"; stop "git add -A into the temporary index failed"; }
  tree=$(GIT_INDEX_FILE="$gidx" git -C "$repo" write-tree) || { rm -f "$idx"; stop "write-tree failed"; }
  rm -f "$idx"; echo "$tree"
}
# base of a saved ref: the slug's wip snapshot only when the ref was built on it (a stale one from an
# earlier run of the same slug is ignored), else merge-base HEAD <ref>
ref_base() { local w; w=$(git -C "$repo" rev-parse -q --verify "refs/council-wip/$1^{commit}") && git -C "$repo" merge-base --is-ancestor "$w" "$2" && echo "$w" && return; git -C "$repo" merge-base HEAD "$2"; }
snap_tree() { git -C "$1" -c core.safecrlf=false add -A >/dev/null && git -C "$1" write-tree; }  # stages untracked work too

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
  while read -r label sha wt; do
    ref="refs/council/$slug/$label"
    if [ -d "$wt" ]; then
      tree=$(snap_tree "$wt") || stop "could not snapshot $wt"
      # keep a save-refs snapshot of the same tree; else HEAD when nothing is uncommitted, else a snapshot on HEAD
      if [ "$(git -C "$repo" rev-parse -q --verify "$ref^{tree}")" != "$tree" ]; then
        if [ "$tree" = "$(git -C "$repo" rev-parse "$sha^{tree}")" ]; then c=$sha
        else c=$(git -C "$repo" commit-tree "$tree" -p "$sha" -m "council-$label") || stop "could not snapshot $wt"; fi
        git -C "$repo" update-ref "$ref" "$c" || stop "could not save $ref"
      fi
    else
      git -C "$repo" update-ref "$ref" "$sha" || stop "could not save $ref"
    fi
    unlink_dep "$wt"
    if [ -d "$wt" ]; then guard_links "$wt"; git -C "$repo" worktree remove --force "$wt" || stop "git worktree remove failed for $wt"; fi
    removed=$((removed + 1))
    echo "removed $wt (saved $ref)"
  done < <(slug_wts)
  git -C "$repo" worktree prune
  if [ -n "$dep" ]; then
    [ -d "$repo/$dep" ] && [ -n "$(ls -A "$repo/$dep")" ] || stop "main checkout dependency dir is missing or empty after cleanup: $repo/$dep"
  fi
  echo "cleaned $removed worktree(s) for slug $slug"
  ;;
save-refs)
  base=${5:-}
  [ -n "$base" ] || stop "save-refs needs <base>"
  git -C "$repo" rev-parse --verify -q "$base^{commit}" >/dev/null || stop "base $base is not a commit"
  saved=0
  while read -r label sha wt; do
    [ -d "$wt" ] || { echo "skipped $wt (directory missing)"; continue; }
    tree=$(snap_tree "$wt") || stop "could not snapshot $wt"
    c=$(git -C "$repo" commit-tree "$tree" -p "$base" -m "council-$label") || stop "could not snapshot $wt"
    git -C "$repo" update-ref "refs/council/$slug/$label" "$c" || stop "could not save refs/council/$slug/$label"
    saved=$((saved + 1))
    echo "saved refs/council/$slug/$label from $wt"
  done < <(slug_wts)
  echo "saved $saved ref(s) for slug $slug"
  ;;
wip-snapshot)
  head=$(git -C "$repo" rev-parse -q --verify HEAD) || stop "no HEAD commit to snapshot on"
  tree=$(wip_tree) || exit 1
  sha=$(git -C "$repo" commit-tree "$tree" -p "$head" -m council-wip) || stop "commit-tree failed"
  git -C "$repo" update-ref "refs/council-wip/$slug" "$sha" || stop "could not save refs/council-wip/$slug"
  echo "$sha"
  ;;
apply)
  label=${5:-}; base=${6:-}; src=${7:-}
  [ -n "$label" ] && [ -n "$base" ] || stop "apply needs <label> <base>"
  safe label "$label"
  patch=$(mktemp "${TMPDIR:-/tmp}/council-$slug-$label.XXXXXX") || stop "mktemp failed"
  if [ "$src" = ref ]; then
    ref="refs/council/$slug/$label"
    git -C "$repo" rev-parse -q --verify "$ref^{commit}" >/dev/null || stop "no saved ref $ref"
    [ "$base" = auto ] && { base=$(ref_base "$slug" "$ref") || stop "no merge-base between HEAD and $ref"; }
    git -C "$repo" diff --no-renames --binary "$base" "$ref" > "$patch" || stop "git diff failed for $ref"
    [ -s "$patch" ] || stop "empty diff against $base in $ref"
    # refuse only when the patch touches a path that is dirty in the main repo: changed against HEAD, or
    # against the wip snapshot when the run was on the working copy (its WIP is the base, not a conflict)
    cmp=HEAD; [ "$base" = "$(git -C "$repo" rev-parse -q --verify "refs/council-wip/$slug^{commit}")" ] && cmp=$base
    cur=$(wip_tree) || exit 1
    hit=$(grep -Fxf <(git -C "$repo" diff --no-renames --name-only -z "$cmp" "$cur" | tr '\0' '\n') \
          <(git -C "$repo" diff --no-renames --name-only -z "$base" "$ref" | tr '\0' '\n'))
    [ -z "$hit" ] || stop "patch touches uncommitted paths in $repo: $(echo $hit)"
    rn=$(basename "$repo")
    # the latest ledger line of this repo+slug decides; no line (or no ledger) means nothing to say
    last=$(grep -F "\"repoName\":\"$rn\",\"slug\":\"$slug\"," "$(ledger_file)" 2>/dev/null | tail -n 1)
    [ -z "$last" ] || printf '%s\n' "$last" | grep -qF "\"label\":\"$label\",\"fate\":\"won\"" \
      || echo "note: $label is not the council's winner for $slug"
  else
    wt=$(wt_of "$label")
    [ -d "$wt" ] || stop "worktree missing: $wt"
    git -C "$wt" add -A || stop "git add -A failed in $wt"
    git -C "$wt" diff --cached --binary "$base" > "$patch" || stop "git diff failed in $wt"
    [ -s "$patch" ] || stop "empty diff against $base in $wt"
  fi
  git -C "$repo" apply --check "$patch" || stop "patch does not apply cleanly to $repo (patch kept at $patch)"
  git -C "$repo" apply "$patch" || stop "git apply failed (patch kept at $patch)"
  echo "applied $patch to $repo (uncommitted)"
  ;;
runs)
  found=0
  while IFS= read -r ref; do
    found=1; s=${ref#refs/council/}; s=${s%/*}
    b=$(ref_base "$s" "$ref") || b=""
    echo "$ref (base ${b:-none})"
    [ -z "$b" ] || git -C "$repo" diff --stat "$b" "$ref" | sed 's/^/    /'
  done < <(git -C "$repo" for-each-ref --format='%(refname)' "refs/council${slug:+/$slug}")
  [ "$found" = 1 ] || echo "no saved council refs${slug:+ for $slug}"
  ;;
doctor)
  bad=0
  problem() { echo "problem: $*"; bad=1; }
  v=$(git --version | sed 's/[^0-9]*\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/')
  if [ "${v%%.*}" -gt 2 ] || { [ "${v%%.*}" -eq 2 ] && [ "${v#*.}" -ge 5 ]; }; then echo "ok: git $v >= 2.5"; else problem "git $v < 2.5 (worktrees need 2.5)"; fi
  for f in "$here/../workflows/"*.js; do
    cr=$(tr -cd '\r' < "$f" | wc -c | tr -d ' ')
    if [ "$cr" = 0 ]; then echo "ok: no CR in $(basename "$f")"; else problem "$cr CR characters in $f (the Workflow tool rejects it)"; fi
  done
  listed=$(git -C "$repo" worktree list --porcelain | sed -n 's/^worktree //p')
  while IFS= read -r wt; do
    case "$(basename "$wt")" in council-wt-*|council-scratch-*|council-review-*) problem "stale worktree $wt" ;; esac
  done <<< "$listed"
  for d in "$parent"/council-wt-* "$parent"/council-scratch-* "$parent"/council-review-*; do
    [ -e "$d" ] || continue
    printf '%s\n' "$listed" | sed 's#.*/##' | grep -qxF "$(basename "$d")" || problem "orphan directory $d (not a registered worktree)"
    while IFS= read -r l; do problem "dangling link $l"; done < <(find "$d" -maxdepth 2 -type l ! -exec test -e {} \; -print 2>/dev/null)
  done
  [ "$bad" = 0 ] && echo "doctor: no problems found by the script"
  exit "$bad"
  ;;
*)
  stop "unknown verb: $verb"
  ;;
esac
