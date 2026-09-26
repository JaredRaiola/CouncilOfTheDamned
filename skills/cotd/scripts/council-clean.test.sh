#!/usr/bin/env bash
# Self-check for council-clean.sh: throwaway repo, a decoy worktree of a look-alike slug (foo-2 vs foo),
# a linked dependency dir, then create / apply / clean with their STOP paths. Run: bash council-clean.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
S="$here/council-clean.sh"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/cotd-test.XXXXXX")
repo="$tmp/repo"; dep=deps; slug=foo
export CLAUDE_CONFIG_DIR="$tmp/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"   # ledger lookups never read the real config dir
n=0
fail() { echo "FAIL: $*"; echo "(left $tmp in place)"; exit 1; }
pass() { n=$((n + 1)); echo "ok $n - $*"; }
run() { out=$("$@" 2>&1); rc=$?; }
expect_stop() { local desc=$1; shift; run "$@"
  [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -q '^STOP:' || fail "$desc: expected STOP, got rc=$rc: $out"
  pass "$desc -> $(printf '%s\n' "$out" | grep '^STOP:' | head -1)"; }
expect_ok() { local desc=$1; shift; run "$@"; [ "$rc" -eq 0 ] || fail "$desc: rc=$rc: $out"; pass "$desc -> $out"; }

git init -q "$repo" && git -C "$repo" config user.name t && git -C "$repo" config user.email t@t || fail "git init"
printf 'one\n' > "$repo/a.txt"; printf '%s/\n' "$dep" > "$repo/.gitignore"
git -C "$repo" add -A && git -C "$repo" commit -q -m init || fail "initial commit"
mkdir "$repo/$dep" && printf 'real\n' > "$repo/$dep/real.txt"
base=$(git -C "$repo" rev-parse HEAD)

# decoy: slug foo-2, label A → council-wt-foo-2-A, with its own dependency link; slug foo must never touch it
expect_ok "decoy create (slug foo-2)" "$S" create "$repo" foo-2 "$dep" A "$base"
decoy="$tmp/council-wt-foo-2-A"; [ -e "$decoy/$dep/real.txt" ] || fail "decoy link missing"

# create
expect_ok "create A" "$S" create "$repo" $slug "$dep" A "$base"
wtA="$tmp/council-wt-$slug-A"
[ -d "$wtA" ] && [ -e "$wtA/$dep/real.txt" ] || fail "A worktree or link missing"
[ "$(git -C "$wtA" rev-parse HEAD)" = "$base" ] || fail "A not at base"
expect_ok "create B" "$S" create "$repo" $slug "$dep" B "$base"
expect_ok "create A-scratch (test-mode reviewer)" "$S" create "$repo" $slug "$dep" A-scratch "$base"
expect_ok "create D (untouched member)" "$S" create "$repo" $slug "$dep" D "$base"
expect_ok "create review (no depDir)" "$S" create "$repo" $slug none review "$base"
[ -d "$tmp/council-review-$slug" ] && [ ! -e "$tmp/council-review-$slug/$dep" ] || fail "review worktree wrong"
expect_stop "create A again (path exists)" "$S" create "$repo" $slug "$dep" A "$base"
expect_stop "create with bad base" "$S" create "$repo" $slug "$dep" C deadbeef
[ ! -e "$tmp/council-wt-$slug-C" ] || fail "bad-base create left a worktree"
expect_stop "create with missing depDir" "$S" create "$repo" $slug nope C "$base"
[ ! -e "$tmp/council-wt-$slug-C" ] || fail "missing-dep create left a worktree"
expect_stop "create with no label/base" "$S" create "$repo" $slug "$dep"
expect_stop "unknown verb" "$S" frob "$repo" $slug "$dep"
expect_stop "not a repo" "$S" create "$tmp" $slug none A "$base"
expect_stop "create with a glob slug" "$S" create "$repo" 'foo?bar' none A "$base"
expect_stop "create rejects a label clean could never match" "$S" create "$repo" $slug none A-1 "$base"
[ ! -e "$tmp/council-wt-$slug-A-1" ] || fail "A-1 worktree was created"

# anchored slug in the other direction: slug fo must not touch foo, and must clean its own
expect_ok "create A for prefix slug fo" "$S" create "$repo" fo "$dep" A "$base"
expect_ok "clean fo (prefix of foo)" "$S" clean "$repo" fo "$dep"
git -C "$repo" worktree list | grep -q "council-wt-$slug-A" || fail "clean fo removed foo's worktree"
[ ! -e "$tmp/council-wt-fo-A" ] || fail "clean fo left its own worktree"
git -C "$repo" rev-parse -q --verify refs/council/fo/A >/dev/null || fail "refs/council/fo/A not saved"
pass "prefix slug fo: foo-A intact, fo-A removed, refs/council/fo/A saved"
expect_stop "create with a path label" "$S" create "$repo" $slug none '../evil' "$base"
[ ! -e "$(dirname "$tmp")/evil" ] && [ ! -e "$tmp/evil" ] || fail "path label escaped"

# multi-label create (one call for every seat) and its STOP-mid-list path, on its own slug
expect_ok "multi-label create A,B,A-scratch (slug ml)" "$S" create "$repo" ml "$dep" A,B,A-scratch "$base"
[ "$(printf '%s\n' "$out" | grep -c '^created ')" = 3 ] || fail "expected 3 created lines: $out"
for L in A B A-scratch; do [ -d "$tmp/council-wt-ml-$L" ] && [ -e "$tmp/council-wt-ml-$L/$dep/real.txt" ] && [ "$(git -C "$tmp/council-wt-ml-$L" rev-parse HEAD)" = "$base" ] || fail "ml $L worktree, link or base wrong"; done
expect_stop "multi-label create C,B,D STOPs at B (exists)" "$S" create "$repo" ml "$dep" C,B,D "$base"
[ -d "$tmp/council-wt-ml-C" ] && [ ! -e "$tmp/council-wt-ml-D" ] || fail "mid-list STOP: C should exist (made before the STOP), D must not"
printf '%s\n' "$out" | grep -q '^created .*council-wt-ml-C$' || fail "C's created line missing before the STOP: $out"
expect_stop "multi-label create E,A-1 STOPs at the bad label" "$S" create "$repo" ml "$dep" E,A-1 "$base"
[ -d "$tmp/council-wt-ml-E" ] && [ ! -e "$tmp/council-wt-ml-A-1" ] || fail "bad-label mid-list: E should exist, A-1 must not"
expect_stop "multi-label create with a glob in the list" "$S" create "$repo" ml "$dep" 'F,*' "$base"
[ ! -e "$tmp/council-wt-ml-F" ] || fail "glob list created F"
expect_stop "multi-label create with a space in the list" "$S" create "$repo" ml "$dep" 'F G' "$base"
[ ! -e "$tmp/council-wt-ml-F" ] && [ ! -e "$tmp/council-wt-ml-G" ] || fail "space list created a worktree"
expect_stop "multi-label create with an empty field in the list" "$S" create "$repo" ml "$dep" 'F,,G' "$base"
[ ! -e "$tmp/council-wt-ml-F" ] && [ ! -e "$tmp/council-wt-ml-G" ] || fail "empty-field list created a worktree"
expect_stop "multi-label create with a bad base makes nothing" "$S" create "$repo" ml "$dep" F,G deadbeef
[ ! -e "$tmp/council-wt-ml-F" ] || fail "bad-base multi create left F"
expect_ok "clean ml undoes the partial creates (SKILL.md's || clean)" "$S" clean "$repo" ml "$dep"
printf '%s\n' "$out" | grep -q "cleaned 5 worktree" || fail "expected 5 ml worktrees cleaned (A B A-scratch C E): $out"
for L in A B A-scratch C E; do [ ! -e "$tmp/council-wt-ml-$L" ] || fail "ml $L survived clean"; done
[ -d "$wtA" ] && [ -f "$repo/$dep/real.txt" ] || fail "clean ml touched foo or deps"
pass "multi-label: 3 created in one call, STOP mid-list kept the earlier ones for clean, bad list rejected before any create, foo untouched"
grep -qF 'create "<git root>" <slug> <depDir|none> A,B,C,D,E <base> || { bash "<skill root>/scripts/council-clean.sh" clean "<git root>" <slug> <depDir|none>; exit 1; }' "$here/../SKILL.md" || fail "SKILL.md §4 lacks the one-call create || clean line"
pass "SKILL.md §4: one create call for all seats with clean-on-STOP"
# the SKILL.md one-liner itself: a STOP at the second label makes clean remove the first, rc=1, deps intact
run bash -c '"$1" create "$2" ml "$3" C,A-1 "$4" || { "$1" clean "$2" ml "$3"; exit 1; }' _ "$S" "$repo" "$dep" "$base"
[ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -q '^STOP:' && printf '%s\n' "$out" | grep -q 'cleaned 1 worktree' && [ ! -e "$tmp/council-wt-ml-C" ] && [ -f "$repo/$dep/real.txt" ] || fail "SKILL.md create||clean one-liner: rc=$rc $out"
pass "SKILL.md one-liner: create C,A-1 STOPs, clean removes C, rc=1, deps intact"

# member A works: tracked edit + new file committed, plus an uncommitted untracked file (add -A must catch it)
printf 'two\n' > "$wtA/a.txt"; printf 'new\n' > "$wtA/new.txt"
git -C "$wtA" add -A && git -C "$wtA" commit -q -m council-A || fail "commit in A"
shaA=$(git -C "$wtA" rev-parse HEAD)
printf 'late\n' > "$wtA/late.txt"

# apply
expect_ok "apply A" "$S" apply "$repo" $slug "$dep" A "$base"
[ "$(cat "$repo/a.txt")" = two ] && [ -f "$repo/new.txt" ] && [ -f "$repo/late.txt" ] || fail "winner diff not applied"
[ "$(git -C "$repo" rev-list --count HEAD)" -eq 1 ] || fail "apply committed something"
[ -n "$(git -C "$repo" status --porcelain)" ] || fail "main repo should be dirty after apply"
expect_stop "apply A twice (does not apply cleanly)" "$S" apply "$repo" $slug "$dep" A "$base"
expect_stop "apply D (empty diff)" "$S" apply "$repo" $slug "$dep" D "$base"
expect_stop "apply Z (no such worktree)" "$S" apply "$repo" $slug "$dep" Z "$base"

# clean with depDir omitted while links exist must STOP before worktree remove --force can follow a junction
expect_stop "clean with depDir none while links exist" "$S" clean "$repo" $slug none
[ -d "$wtA" ] && [ -e "$wtA/$dep/real.txt" ] && [ -f "$repo/$dep/real.txt" ] || fail "none-clean removed a worktree or damaged deps"
expect_stop "clean with a glob slug" "$S" clean "$repo" 'fo?' "$dep"
[ -d "$wtA" ] || fail "glob-slug clean touched foo"

# clean
expect_ok "clean $slug" "$S" clean "$repo" $slug "$dep"
[ -d "$decoy" ] && [ -e "$decoy/$dep/real.txt" ] || fail "decoy was touched"
git -C "$repo" worktree list | grep -q "council-wt-foo-2-A" || fail "decoy missing from worktree list"
for L in A B A-scratch D review; do
  git -C "$repo" show-ref --verify -q "refs/council/$slug/$L" || fail "ref refs/council/$slug/$L missing"
done
# A had late.txt uncommitted (staged by apply): the ref is a snapshot on A's commit that keeps it; untouched B is plain HEAD
[ "$(git -C "$repo" rev-parse "refs/council/$slug/A^")" = "$shaA" ] || fail "ref A is not a snapshot on A's commit"
[ "$(git -C "$repo" show "refs/council/$slug/A:late.txt")" = late ] || fail "ref A lost A's uncommitted late.txt"
[ "$(git -C "$repo" rev-parse "refs/council/$slug/B")" = "$base" ] || fail "ref B is not B's HEAD"
[ ! -e "$wtA/$dep" ] && [ ! -L "$wtA/$dep" ] || fail "A link still present"
[ ! -d "$wtA" ] && [ ! -d "$tmp/council-wt-$slug-B" ] && [ ! -d "$tmp/council-wt-$slug-A-scratch" ] && [ ! -d "$tmp/council-review-$slug" ] || fail "a worktree survived"
! git -C "$repo" worktree list | grep -q "council-wt-$slug-[A-J]" || fail "worktree list still has $slug"
[ -f "$repo/$dep/real.txt" ] && [ "$(cat "$repo/$dep/real.txt")" = real ] || fail "REAL DEPENDENCY DIR DAMAGED"
pass "after clean: decoy intact with link, 5 refs saved (A=$shaA), links gone, $repo/$dep intact"
expect_ok "clean $slug again (nothing left)" "$S" clean "$repo" $slug "$dep"
printf '%s\n' "$out" | grep -q "cleaned 0 worktree" || fail "second clean should remove nothing"

# a link that cannot be removed must STOP before any worktree removal
expect_ok "create E" "$S" create "$repo" $slug "$dep" E "$base"
wtE="$tmp/council-wt-$slug-E"
case "$(uname -s)" in MINGW*|MSYS*) cmd //c rmdir "$(cygpath -w "$wtE/$dep")" ;; CYGWIN*) cmd /c rmdir "$(cygpath -w "$wtE/$dep")" ;; *) rm "$wtE/$dep" ;; esac
mkdir "$wtE/$dep" && printf 'x\n' > "$wtE/$dep/not-a-link.txt"   # a real dir where the link should be: rmdir/rm cannot remove it
expect_stop "clean with an unremovable link" "$S" clean "$repo" $slug "$dep"
[ -d "$wtE" ] || fail "worktree E was removed despite STOP"
git -C "$repo" show-ref --verify -q "refs/council/$slug/E" || fail "ref E should be saved before the STOP"
rm "$wtE/$dep/not-a-link.txt" && rmdir "$wtE/$dep"
expect_ok "clean $slug after fixing the link" "$S" clean "$repo" $slug "$dep"
[ ! -d "$wtE" ] || fail "E survived"

# SKILL.md passes the repo in C:\ form on Windows; the script must accept it (no-op elsewhere)
if command -v cygpath >/dev/null 2>&1; then
  winrepo=$(cygpath -w "$repo")
  expect_ok "create F with a C:\\ repo path" "$S" create "$winrepo" $slug "$dep" F "$base"
  [ -e "$tmp/council-wt-$slug-F/$dep/real.txt" ] || fail "F link missing"
  expect_ok "clean $slug with a C:\\ repo path" "$S" clean "$winrepo" $slug "$dep"
  [ ! -d "$tmp/council-wt-$slug-F" ] && [ -f "$repo/$dep/real.txt" ] || fail "F cleanup"
fi

# finally the decoy, via its own slug
expect_ok "clean foo-2 (decoy by its own slug)" "$S" clean "$repo" foo-2 "$dep"
[ ! -d "$decoy" ] && [ -f "$repo/$dep/real.txt" ] || fail "decoy cleanup"
[ -z "$(find "$tmp" -name "$dep" -not -path "$repo/*")" ] || fail "a dependency link survived somewhere"

# ---- wip-snapshot: staged, unstaged, untracked work; HEAD, branch, real index and status untouched ----
r2="$tmp/wip"; git init -q "$r2" && git -C "$r2" config user.name t && git -C "$r2" config user.email t@t || fail "git init wip"
expect_stop "wip-snapshot before the first commit" "$S" wip-snapshot "$r2" w1
printf 'base\n' > "$r2/tracked.txt"; printf 'keep\n' > "$r2/other.txt"; printf 'ign/\n' > "$r2/.gitignore"
mkdir "$r2/ign" && printf 'forced\n' > "$r2/ign/forced.txt"
git -C "$r2" add tracked.txt other.txt .gitignore && git -C "$r2" add -f ign/forced.txt && git -C "$r2" commit -q -m init || fail "wip init commit"
head2=$(git -C "$r2" rev-parse HEAD); br2=$(git -C "$r2" branch --show-current)
expect_ok "wip-snapshot of a clean tree" "$S" wip-snapshot "$r2" w0
[ "$(git -C "$r2" rev-parse "${out##*$'\n'}^{tree}")" = "$(git -C "$r2" rev-parse "HEAD^{tree}")" ] || fail "clean snapshot tree differs from HEAD"
printf 'staged\n' > "$r2/staged.txt"; git -C "$r2" add staged.txt
printf 'unstaged\n' >> "$r2/tracked.txt"; printf 'untracked\n' > "$r2/untracked.txt"
printf 'ignored\n' > "$r2/ign/new-ignored.txt"; rm "$r2/other.txt"
st1=$(git -C "$r2" status --porcelain); ls1=$(git -C "$r2" ls-files -s)
expect_ok "wip-snapshot of staged+unstaged+untracked+deleted work" "$S" wip-snapshot "$r2" w1
snap=${out##*$'\n'}   # the sha is the last line; git may print CRLF warnings first
[ "$(git -C "$r2" rev-parse HEAD)" = "$head2" ] && [ "$(git -C "$r2" branch --show-current)" = "$br2" ] || fail "HEAD or branch moved"
[ "$(git -C "$r2" status --porcelain)" = "$st1" ] && [ "$(git -C "$r2" ls-files -s)" = "$ls1" ] || fail "status or real index changed"
[ "$(git -C "$r2" rev-parse "$snap^")" = "$head2" ] && [ "$(git -C "$r2" rev-parse refs/council-wip/w1)" = "$snap" ] || fail "snapshot parent/ref wrong"
[ "$(git -C "$r2" show "$snap:staged.txt")" = staged ] && [ "$(git -C "$r2" show "$snap:tracked.txt")" = "$(printf 'base\nunstaged')" ] \
  && [ "$(git -C "$r2" show "$snap:untracked.txt")" = untracked ] && [ "$(git -C "$r2" show "$snap:ign/forced.txt")" = forced ] || fail "snapshot content wrong"
! git -C "$r2" cat-file -e "$snap:ign/new-ignored.txt" 2>/dev/null && ! git -C "$r2" cat-file -e "$snap:other.txt" 2>/dev/null || fail "snapshot kept an ignored or deleted file"
pass "wip snapshot $snap: HEAD=$head2 branch=$br2 status+index identical ($(printf '%s\n' "$st1" | wc -l | tr -d ' ') porcelain lines), tracked-ignored kept, new-ignored and deleted left out"
git -C "$r2" gc -q --prune=now || fail "gc"
[ "$(git -C "$r2" rev-parse refs/council-wip/w1)" = "$snap" ] && [ "$(git -C "$r2" show "$snap:untracked.txt")" = untracked ] || fail "snapshot lost to gc"
[ "$(git -C "$r2" status --porcelain)" = "$st1" ] || fail "gc changed status"
pass "snapshot and its untracked blob survive git gc --prune=now"

# racy index: a same-size edit of a tracked file whose mtime equals the index mtime must still be captured (cp -p in wip_tree)
cp -p "$r2/staged.txt" "$tmp/u-mtime" || fail "cp -p"
tr a-z A-Z < "$tmp/u-mtime" > "$r2/staged.txt"   # byte-for-byte same size
touch -r "$tmp/u-mtime" "$r2/staged.txt" "$(git -C "$r2" rev-parse --absolute-git-dir)/index" || fail "touch -r"
expect_ok "wip-snapshot after a same-second same-size edit" "$S" wip-snapshot "$r2" w1r
[ "$(git -C "$r2" show "refs/council-wip/w1r:staged.txt" | tr -d '
')" = STAGED ] || fail "snapshot missed the same-second same-size edit (racy index)"
pass "racy index: same-size same-mtime edit captured by wip-snapshot"
printf 'staged' > "$r2/staged.txt"   # back to the WIP state for the run below

# ---- wip run: member at the snapshot, save-refs before the verdict branch, delivery onto the dirty tree ----
expect_ok "create member A at the wip snapshot" "$S" create "$r2" w1 none A "$snap"
wA2="$tmp/council-wt-w1-A"
grep -q "^untracked" "$wA2/untracked.txt" || fail "member worktree lacks the WIP untracked file"
printf 'council\n' >> "$wA2/tracked.txt"; printf 'mine\n' > "$wA2/council-new.txt"
git -C "$wA2" add -A && git -C "$wA2" commit -q -m council-A || fail "commit in wip A"
printf 'uncommitted\n' > "$wA2/council-late.txt"
expect_stop "save-refs without a base" "$S" save-refs "$r2" w1 none
expect_ok "save-refs (member work partly uncommitted)" "$S" save-refs "$r2" w1 none "$snap"
[ -d "$wA2" ] || fail "save-refs removed a worktree"
[ "$(git -C "$r2" rev-parse refs/council/w1/A^)" = "$snap" ] && [ "$(git -C "$r2" show refs/council/w1/A:council-late.txt)" = uncommitted ] || fail "save-refs snapshot wrong"
view=$(git -C "$r2" diff --stat "$snap" refs/council/w1/A)
printf '%s\n' "$view" | grep -q council-new.txt && printf '%s\n' "$view" | grep -q council-late.txt && ! printf '%s\n' "$view" | grep -q 'untracked.txt\|staged.txt' || fail "council-only view shows WIP: $view"
pass "council-only view (diff --stat snapshot ref): $(printf '%s\n' "$view" | tail -1 | sed 's/^ *//')"
expect_ok "deliver A onto the dirty tree" "$S" apply "$r2" w1 none A "$snap"
[ "$(git -C "$r2" rev-parse HEAD)" = "$head2" ] && [ "$(git -C "$r2" branch --show-current)" = "$br2" ] || fail "delivery moved HEAD"
[ "$(tr -d '\r' < "$r2/tracked.txt")" = "$(printf 'base\nunstaged\ncouncil')" ] && [ "$(tr -d '\r' < "$r2/untracked.txt")" = untracked ] && [ -f "$r2/council-new.txt" ] \
  && [ "$(git -C "$r2" show :staged.txt)" = staged ] && [ ! -e "$r2/other.txt" ] || fail "delivery lost WIP or council work"
pass "wip delivery: WIP kept (staged still staged, unstaged line, untracked, deletion) plus council lines, HEAD unchanged"
# /cotd apply from the saved ref of a wip run: the WIP is the patch's base, so only edits made since the snapshot block it
expect_stop "apply wip ref when the tree already has the council lines (changed since the snapshot)" "$S" apply "$r2" w1 none A auto ref
printf 'base\nunstaged\n' > "$r2/tracked.txt"; rm "$r2/council-new.txt" "$r2/council-late.txt"   # back to the WIP state
expect_ok "apply wip ref onto the dirty tree (touches a WIP-dirty file)" "$S" apply "$r2" w1 none A auto ref
[ "$(tr -d '\r' < "$r2/tracked.txt")" = "$(printf 'base\nunstaged\ncouncil')" ] && [ -f "$r2/council-late.txt" ] && [ "$(git -C "$r2" show :staged.txt)" = staged ] \
  && [ "$(git -C "$r2" rev-parse HEAD)" = "$head2" ] || fail "wip ref delivery lost WIP or council work"
pass "wip ref delivery: WIP kept plus council lines, HEAD unchanged"
expect_ok "clean wip run" "$S" clean "$r2" w1 none

# ---- runs, apply <ref>, ledger winner note ----
expect_ok "runs (all slugs)" "$S" runs "$repo"
printf '%s\n' "$out" | grep -q 'refs/council/foo/A (base' && printf '%s\n' "$out" | grep -q 'refs/council/foo-2/A' && printf '%s\n' "$out" | grep -q 'late.txt' || fail "runs output: $out"
expect_ok "runs foo (slug filter)" "$S" runs "$repo" foo
! printf '%s\n' "$out" | grep -q 'foo-2' || fail "runs foo listed foo-2"
expect_ok "runs for an unknown slug" "$S" runs "$repo" nosuch
[ "$out" = "no saved council refs for nosuch" ] || fail "runs nosuch: $out"
expect_stop "apply ref for a label with no ref" "$S" apply "$repo" foo none Z auto ref
expect_stop "apply ref while the patch's paths are dirty" "$S" apply "$repo" foo none A auto ref
git -C "$repo" checkout -q -- . && rm -f "$repo/new.txt" "$repo/late.txt"
printf 'x\n' > "$repo/unrelated.txt"   # a dirty path the patch does not touch must not block it
expect_ok "apply ref A (dirty but disjoint tree, no ledger: no winner note)" "$S" apply "$repo" foo none A auto ref
! printf '%s\n' "$out" | grep -q "not the council's winner" && [ -f "$repo/late.txt" ] && grep -q "^two" "$repo/a.txt" && [ -f "$repo/unrelated.txt" ] || fail "apply ref: $out"
git -C "$repo" checkout -q -- . && rm -f "$repo/new.txt" "$repo/late.txt"
# same slug in another repo naming A the winner must not count, nor an older run of this slug; the latest line names B
printf '%s\n' '{"date":"2026-09-24","repoName":"repo","slug":"foo","mode":"build","runId":"repo/2026-09-24-foo","agentCalls":4,"tokens":0,"flawed":false,"seats":[{"seat":"opus:high","label":"A","fate":"won"}]}' \
  '{"date":"2026-09-25","repoName":"other","slug":"foo","mode":"build","runId":"other/2026-09-25-foo","agentCalls":4,"tokens":0,"flawed":false,"seats":[{"seat":"opus:high","label":"A","fate":"won"}]}' \
  '{"date":"2026-09-25","repoName":"repo","slug":"foo","mode":"build","runId":"repo/2026-09-25-foo","agentCalls":9,"tokens":1200,"flawed":false,"seats":[{"seat":"opus:high","label":"A","fate":"ranked:2"},{"seat":"sonnet:high","label":"B","fate":"won"}]}' > "$CLAUDE_CONFIG_DIR/council-ledger.jsonl"
expect_ok "apply ref A while the ledger names B the winner" "$S" apply "$repo" foo none A auto ref
printf '%s\n' "$out" | grep -q "note: A is not the council's winner for foo" || fail "A not flagged: $out"
git -C "$repo" checkout -q -- . && rm -f "$repo/new.txt" "$repo/late.txt"
printf '%s\n' '{"date":"2026-09-25","repoName":"repo","slug":"foo","mode":"build","runId":"repo/2026-09-25-foo","agentCalls":9,"tokens":1200,"flawed":false,"seats":[{"seat":"opus:high","label":"A","fate":"won"},{"seat":"sonnet:high","label":"B","fate":"ranked:2"},{"seat":"sonnet:high","label":"D","fate":"doa"}]}' > "$CLAUDE_CONFIG_DIR/council-ledger.jsonl"
expect_ok "apply ref A with the ledger naming A the winner" "$S" apply "$repo" foo none A auto ref
! printf '%s\n' "$out" | grep -q "not the council's winner" || fail "winner flagged as not winner"
git -C "$repo" checkout -q -- . && rm -f "$repo/new.txt" "$repo/late.txt"
printf 'two\n' > "$repo/a.txt"; git -C "$repo" add a.txt && git -C "$repo" commit -q -m moved   # throwaway repo only: HEAD now has a.txt=two
expect_stop "apply ref A after HEAD already has its change (apply --check fails)" "$S" apply "$repo" foo none A auto ref

# ---- a stale refs/council-wip/<slug> from an earlier wip run of the same slug is not the base of a later run ----
r3="$tmp/reuse"; git init -q "$r3" && git -C "$r3" config user.name t && git -C "$r3" config user.email t@t && printf 'a\n' > "$r3/a.txt" \
  && git -C "$r3" add a.txt && git -C "$r3" commit -q -m init || fail "git init reuse"
printf 'u\n' > "$r3/u.txt"; run "$S" wip-snapshot "$r3" s; w3=${out##*$'\n'}
"$S" create "$r3" s none A "$w3" >/dev/null && printf 'm\n' > "$tmp/council-wt-s-A/m.txt" && "$S" save-refs "$r3" s none "$w3" >/dev/null && "$S" clean "$r3" s none >/dev/null || fail "first (wip) run of slug s"
rm "$r3/u.txt"; h3=$(git -C "$r3" rev-parse HEAD)
"$S" create "$r3" s none A "$h3" >/dev/null && printf 'm2\n' > "$tmp/council-wt-s-A/m2.txt" && "$S" save-refs "$r3" s none "$h3" >/dev/null && "$S" clean "$r3" s none >/dev/null || fail "second (plain) run of slug s"
expect_ok "runs s after reusing a wip slug" "$S" runs "$r3" s
printf '%s\n' "$out" | grep -q "(base $h3)" && printf '%s\n' "$out" | grep -q m2.txt && ! printf '%s\n' "$out" | grep -q u.txt || fail "runs used the stale wip ref: $out"
expect_ok "apply ref after reusing a wip slug" "$S" apply "$r3" s none A auto ref
[ -f "$r3/m2.txt" ] && [ ! -e "$r3/u.txt" ] && [ ! -e "$r3/m.txt" ] || fail "apply used the stale wip ref"

# ---- stats over the ledger ----
printf '%s\n' '{"date":"2026-09-25","repoName":"repo","slug":"d1","mode":"design","runId":"repo/2026-09-25-d1","agentCalls":5,"tokens":0,"flawed":true,"seats":[{"seat":"opus:high","label":"A","fate":"eliminated"},{"seat":"sonnet:high","label":"B","fate":"died"}]}' \
  '{"date":"2026-09-25","repoName":"repo","slug":"r1","mode":"review","runId":"repo/2026-09-25-r1","agentCalls":3,"tokens":0,"flawed":false,"seats":[{"seat":"opus:high","label":"A","fate":"unranked"}]}' >> "$CLAUDE_CONFIG_DIR/council-ledger.jsonl"
expect_ok "stats" "$S" stats
printf '%s\n' "$out" | grep -Eq '^opus:high +3 +1 +0 +1 +0 +0 +1$' && printf '%s\n' "$out" | grep -Eq '^sonnet:high +3 +0 +1 +0 +1 +1 +0$' \
  && printf '%s\n' "$out" | grep -Eq '^build +1 +1 +1 +0 +1 +0 +0$' && printf '%s\n' "$out" | grep -Eq '^review +1 +0 +0 +0 +0 +0 +1$' || fail "stats: $out"
for i in $(seq 1 100); do echo '{"mode":"ancient","seats":[{"seat":"haiku:low","label":"A","fate":"won"}]}'; done > "$tmp/l.jsonl"
for i in $(seq 1 500); do echo '{"mode":"build","seats":[{"seat":"opus:max","label":"A","fate":"won"}]}'; done >> "$tmp/l.jsonl"
mv "$tmp/l.jsonl" "$CLAUDE_CONFIG_DIR/council-ledger.jsonl"
expect_ok "stats reads only the last 500 lines" "$S" stats
! printf '%s\n' "$out" | grep -q 'ancient\|haiku' && printf '%s\n' "$out" | grep -Eq '^opus:max +500 +500' || fail "stats window: $out"
echo '{"flawed":false,"seats":[{"fate":"won","seat":"opus:high","label":"A"},{"label":"B","fate":"ranked:2","seat":"sonnet:high"}],"mode":"build"}' > "$CLAUDE_CONFIG_DIR/council-ledger.jsonl"
expect_ok "stats counts seats whose keys were re-serialized in another order" "$S" stats
printf '%s\n' "$out" | grep -Eq '^opus:high +1 +1 ' && printf '%s\n' "$out" | grep -Eq '^sonnet:high +1 +0 +1 ' && printf '%s\n' "$out" | grep -Eq '^build +1 +1 +1 ' || fail "stats key order: $out"
rm "$CLAUDE_CONFIG_DIR/council-ledger.jsonl"
expect_ok "stats with no ledger" "$S" stats
printf '%s\n' "$out" | grep -q '^no ledger at' || fail "stats no ledger: $out"

# ---- doctor (read-only) ----
mkjunction() { case "$(uname -s)" in MINGW*|MSYS*) cmd //c mklink //J "$(cygpath -w "$1")" "$(cygpath -w "$2")" >/dev/null ;; CYGWIN*) cmd /c mklink /J "$(cygpath -w "$1")" "$(cygpath -w "$2")" >/dev/null ;; *) ln -s "$2" "$1" ;; esac; }
rmjunction() { case "$(uname -s)" in MINGW*|MSYS*) cmd //c rmdir "$(cygpath -w "$1")" ;; CYGWIN*) cmd /c rmdir "$(cygpath -w "$1")" ;; *) rm "$1" ;; esac; }
expect_ok "doctor on a clean setup" "$S" doctor "$repo"
printf '%s\n' "$out" | grep -q '^ok: git .* >= 2.5' && printf '%s\n' "$out" | grep -q 'ok: no CR in council-decide.js' || fail "doctor clean: $out"
expect_ok "create a stale worktree" "$S" create "$repo" stale none B "$(git -C "$repo" rev-parse HEAD)"
mkdir "$tmp/council-wt-zz-A" "$tmp/gone"; mkjunction "$tmp/council-wt-zz-A/deps" "$tmp/gone"; rmdir "$tmp/gone"
run "$S" doctor "$repo"
[ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -q 'problem: stale worktree .*council-wt-stale-B' && printf '%s\n' "$out" | grep -q 'problem: orphan directory .*council-wt-zz-A' \
  && printf '%s\n' "$out" | grep -q 'problem: dangling link .*council-wt-zz-A/deps' && ! printf '%s\n' "$out" | grep -q 'orphan directory .*council-wt-stale-B' || fail "doctor problems: rc=$rc $out"
[ -d "$tmp/council-wt-stale-B" ] && [ -e "$tmp/council-wt-zz-A" ] || fail "doctor changed something"
pass "doctor rc=1, changed nothing:$(printf '%s\n' "$out" | grep problem | sed 's/^/ | /' | tr -d '\n')"
rmjunction "$tmp/council-wt-zz-A/deps"; rmdir "$tmp/council-wt-zz-A"
expect_ok "clean stale" "$S" clean "$repo" stale none
mkdir -p "$tmp/fake/scripts" "$tmp/fake/workflows" && cp "$S" "$tmp/fake/scripts/" && printf 'a\r\nb\r\n' > "$tmp/fake/workflows/x.js"
run bash "$tmp/fake/scripts/council-clean.sh" doctor "$repo"
[ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -q 'problem: 2 CR characters in .*x.js' || fail "doctor CR: $out"
pass "doctor flags CRs: $(printf '%s\n' "$out" | grep CR)"
# ---- ledger-append: appends one line to a jsonl file, creating its directory ----
ledger="$tmp/nested/dir/council-ledger.jsonl"
linefile="$tmp/line1.json"; printf '{"a":1}
' > "$linefile"
expect_ok "ledger-append creates dir + appends" "$S" ledger-append "$ledger" "$linefile"
[ -f "$ledger" ] || fail "ledger file not created"
[ "$(cat "$ledger")" = '{"a":1}' ] || fail "ledger line 1 wrong: $(cat "$ledger")"
linefile2="$tmp/line2.json"; printf '{"a":2}
' > "$linefile2"
expect_ok "ledger-append a second line" "$S" ledger-append "$ledger" "$linefile2"
[ "$(wc -l < "$ledger" | tr -d ' ')" = 2 ] || fail "ledger should have 2 lines, got: $(cat "$ledger")"
expect_stop "ledger-append with a missing line file" "$S" ledger-append "$ledger" "$tmp/nope.json"
pass "ledger-append: created nested dir, appended 2 lines, STOPs on missing line file"

# ---- core.autocrlf=true + core.safecrlf=true: a mixed-EOL file must not STOP a snapshot (wip-snapshot, save-refs, clean) ----
c="$tmp/c/repo"; mkdir -p "$c" && git init -q "$c" && git -C "$c" config user.name t && git -C "$c" config user.email t@t
printf 'a
' > "$c/a.txt"; git -C "$c" add -A && git -C "$c" commit -q -m init; cb=$(git -C "$c" rev-parse HEAD)
git -C "$c" config core.autocrlf true && git -C "$c" config core.safecrlf true
printf 'a
b
' > "$c/mixed.txt"
expect_ok "wip-snapshot with safecrlf=true and a mixed-EOL file" "$S" wip-snapshot "$c" crlf
git -C "$c" cat-file -e "$(printf '%s
' "$out" | tail -1):mixed.txt" || fail "mixed.txt not in snapshot"
expect_ok "create crlf member A" "$S" create "$c" crlf none A "$cb"
printf 'x
y
' > "$tmp/c/council-wt-crlf-A/m.txt"
expect_ok "save-refs with safecrlf=true" "$S" save-refs "$c" crlf none "$cb"
git -C "$c" cat-file -e refs/council/crlf/A:m.txt || fail "m.txt not in saved ref"
expect_ok "clean with safecrlf=true" "$S" clean "$c" crlf none
! git -C "$c" worktree list | grep -q council-wt-crlf-A || fail "clean left the worktree registered"
pass "safecrlf=true: wip-snapshot, save-refs and clean all snapshot mixed-EOL files and clean removes the worktree"

# ---- no git identity configured: commit-tree must still work ----
nohome="$tmp/nohome"; mkdir -p "$nohome"
run env HOME="$nohome" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME= GIT_AUTHOR_EMAIL= GIT_COMMITTER_NAME= GIT_COMMITTER_EMAIL= bash "$S" wip-snapshot "$c" noid
[ "$rc" -eq 0 ] && printf '%s
' "$out" | tail -1 | grep -Eq '^[0-9a-f]{40}$' || fail "wip-snapshot without a git identity: rc=$rc: $out"
pass "wip-snapshot works with no git identity (fallback council@localhost)"

rm -rf "$tmp"
echo "$n checks passed"
