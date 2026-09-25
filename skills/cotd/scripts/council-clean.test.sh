#!/usr/bin/env bash
# Self-check for council-clean.sh: throwaway repo, a decoy worktree of a look-alike slug (foo-2 vs foo),
# a linked dependency dir, then create / apply / clean with their STOP paths. Run: bash council-clean.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
S="$here/council-clean.sh"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/cotd-test.XXXXXX")
repo="$tmp/repo"; dep=deps; slug=foo
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
[ "$(git -C "$repo" rev-parse "refs/council/$slug/A")" = "$shaA" ] || fail "ref A is not A's commit"
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
rm -rf "$tmp"
echo "$n checks passed"
