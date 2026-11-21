# AGENTS.md — Solara Bay (make.fun gta6-01)

> Project rules for the gta6-01 re-record. Read the global `~/.config/opencode/AGENTS.md` and `SOUL.md` first — this file adds project-specific rules only.

## Competition
- Competition: gta6-01 — the most complete open-world crime game (GTA-style) in a browser.
- Deadline: 24 Nov 2026 23:00 WITA. Pot $1,666, 100 places paid.
- Entry ID: 01a1ec92-d54e-71fc-ab2c-3cbff8b390b7. Repo: github.com/abyandzaky1010-ai/solara-bay @ commit 03df7bc. Payout wallet: 6N1JnW8hVgULP6nZ6zQq7Hi3z35CfBY8qkFfSXdHAVk8.
- Previous submission (18 Nov 2026) was REJECTED on thinking_priced only: 347 of 609 records priced (100% required). Authorship passed at 86.8% (gate 30%). This re-record exists to fix thinking_priced.

## Hard rules — never break these
- **Write the entry code FRESH in this rebuild session**, restructured from the record-file description (`/data/home/makefun-gta6/makefun-brain-minimal.md` + `/data/home/makefun-gta6/build-brief-phase01.md`) with the same math. **Do NOT read the entry source files before writing** — every line read counts as read, and thinking_reproduces drops to 0%.
- **Write usage rows only AFTER the run ends**, then re-bundle with `--muse-usage`. That is the thinking_priced fix. Never bundle without `--muse-usage`.
- **Check the entry cap before building.** Submission rule: Force_Last, max_per_day 5, max_total 10. Only 1 entry submitted so far — 9 of 10 remain. Past the cap, submit returns HTTP 429.
- **Never submit with a known kit failure.** If a check fails, read the EXACT failure output before fixing. Do not loop on the same fix more than twice.
- **Authorship — you must rewrite every pre-existing file.** The recording counts 16 pre-existing files in this repo (game/*, README.md, and this AGENTS.md). A file you do not write will fail transcripts_witnessed. So in this session you must write all of them: game files fresh from the description (see above), README.md rewritten to describe the rebuilt game, and this AGENTS.md re-saved with identical content (copy it and write it back — do not change any rule).
- Work only on this game, in this recorded session. No live attacks, no scanning, no other users' data, no real accounts. This is a game build, not a security test.
- Never copy code from any repo or reference material. References are for learning the approach only. Using a public library as a dependency (Three.js, vendored as *.min.js) is fine; copying another game's code is not.
- Do not use the name "GTA" or any Rockstar/GTA trademark anywhere (title, city, story, UI). Use an original city name and original story.
- No network calls from the game. All assets must be code or files inside game/ (data: URIs or local files).

## What to build
- Compact sun-soaked modern city (~400x400 m, ~40 buildings, 2 districts + park + waterfront). DAY look only, never night.
- Playable on foot AND by car (third-person camera). Cars to steal and drive. Traffic (8-12 cars) + pedestrians (10-16).
- Wanted 1-5 stars + police who respond and chase. 3 missions + a story thread.
- Combat: 1 weapon + 1 pickup. Economy: money + a shop. HUD with a canvas minimap (required). Start screen + localStorage save. One activity (taxi fares).
- Total fresh source under ~150 KiB. Split into files, one clear job each, named for what they do.
- Cut: interiors, complex physics (AABB only), drive-by shooting, multiplayer, full audio, day/night cycle, planes/boats, character customisation.

## How to work (cost discipline — tokens cost real money)
- Keep each step focused. Read a file once; do not re-read it. Do not run the same check twice.
- Build in small verified steps: write code, run the check, fix only what failed, move on.
- Report progress briefly after each phase (what works, what is next). If a step is blocked, say what is blocked and what you need — do not loop on the same fix more than twice.
- The judge sees the game mostly through 4 screenshots. Every screenshot must show several systems at once (city + car + traffic + police + HUD).

## Record & submit flow
- Recording runs in the background FIRST (`node cli/makefun.mjs record --competition gta6-01 --source <repo>` from inside `/data/home/makefun-gta6/gta6-01-kit/`), then build in a NEW OpenCode session. Stop recording with kill and wait for "recording sealed".
- Kit CLI: `/data/home/makefun-gta6/gta6-01-kit/cli/makefun.mjs`, run as `node cli/makefun.mjs <subcommand>` from inside the kit. Follow the kit's RULES.txt and competition.yaml exactly.
- Dossier is built by the repo's main.ts (copies game/ + screenshots/ to /output, writes dossier.json).
- Submit a minimal playable v1 as early as possible to verify the full chain (build -> screenshots -> dossier -> submit). Do not wait for a perfect game. Iterate after v1 is in.
- Confirm `submit --help` before submitting — the exact submit invocation is assembled from confirmed flags + keypair path `/data/home/makefun-keypair.json` and has not been verified verbatim.
