---
target: src/ui/screens/HomeScreen.tsx
total_score: 35
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:C:\\Users\\fakih\\Desktop\\Dromex\\DROMEX\\src\\ui\\screens\\HomeScreen.tsx"
target_fingerprint: "sha256:c2051c73f6716e54a1d2c40362e3e147f972776e9a854cc20a79b28ac148ee87"
target_path: "C:\\Users\\fakih\\Desktop\\Dromex\\DROMEX\\src\\ui\\screens\\HomeScreen.tsx"
timestamp: 2026-09-02T22-03-48Z
slug: src-ui-screens-homescreen-tsx
---
⚠️ DEGRADED: single-context, code-inspection re-score (no live device/emulator or dual sub-agent run available in this environment)

## Correction notice

The **35/40** score reported at the end of "Home screen, phase 1" was **overstated** and is superseded by this entry. Two of its claims did not hold up under the deeper audit requested afterward:

1. **Heuristic #1 (Visibility of System Status) was scored 4/4, but should have been ~2/4.** Phase 1's Attention fix only added `otherDrafts` to the visible breakdown text. `AttentionSnapshot` actually carries 8 fields (`syncPending, unpricedLoads, outstandingRecords, missingReportsToday, incompleteWaste, blockedSchedule, openIssues, loadDrafts`); the headline total was (and always had been) the sum of *all eight* plus `otherDrafts`, but the visible breakdown only ever named three of them. Phase 1 left five fields (`syncPending`, `unpricedLoads`, `outstandingRecords`, `incompleteWaste`, `loadDrafts`) silently folded into the total with no visible explanation — the same class of bug the original critique flagged, just narrower. **Corrected phase-1 score: 33/40**, not 35/40.
2. **The "Verify" step's touch-target claim ("grep-verified every `minHeight` ≥48") was true but insufficient**, and shouldn't have been presented as a completed audit. Grepping `minHeight` cannot catch a `TouchableOpacity` with no sizing style at all — three real gaps were found this way: the "Clear dates," "Open all," and "Open finances" text-link buttons had no touch-target sizing whatsoever, and `Hide`/`Customize` had height but no guaranteed width.
3. **Phase 1 also introduced a real regression**: the Draft Center shortcut was rendered only in the final (`ready`-state) return, so it disappeared entirely during the loading and error states — the opposite of "always visible and tappable."

All three are fixed in this correction pass (see below). Corrected score for the current state:

## Design Health Score (corrected, current state)

| # | Heuristic | Score | Note |
|---|-----------|-------|------|
| 1 | Visibility of System Status | 4 | Breakdown now reconciles exactly with the total across four named groups (operational/financial/synchronization/drafts, covering all 8 snapshot fields + local drafts); Draft Center is now unconditionally rendered in loading, error, zero, and populated states. |
| 2 | Match Between System / Real World | 4 | Unchanged — "APPEARS IN DAILY REPORTS" replaced the jargon badge. |
| 3 | User Control and Freedom | 4 | Unchanged; Retry now has real button styling (border/background), not just colored text. |
| 4 | Consistency and Standards | 4 | Full manual Pressable/TouchableOpacity audit performed (not grep-only) across all three files; every effective touch area is now ≥48×48dp via explicit sizing or `hitSlop`; accessibility roles/states added broadly. |
| 5 | Error Prevention | 3 | Unchanged. |
| 6 | Recognition Rather Than Recall | 4 | Unchanged. |
| 7 | Flexibility and Efficiency of Use | 3 | Unchanged. |
| 8 | Aesthetic and Minimalist Design | 3 | Unchanged. |
| 9 | Error Recovery | 4 | Unchanged, Retry now more clearly actionable. |
| 10 | Help and Documentation | 2 | Unchanged. |
| **Total** | | **35/40** | **Good (87.5%)** — this time earned by a verified fix, not an incomplete one. |

**True history**: 24/40 (original) → 33/40 (actual end of phase 1, corrected from the overstated 35) → 35/40 (this correction pass).

## Remaining findings (still open, unchanged from before)
- No drawn icon system; domain differentiation uses a restrained numbered marker.
- "Daily project reports" / "Reports center" still share one handler.
- 13 advisory `design-system-color` detector findings remain undocumented in `DESIGN.md`.
- **New, from this pass**: a plausible header overlap/clipping risk at 320dp width was identified by static reasoning (the cloud-status badge's longest possible text, e.g. "Locally protected," could exceed the space left after the fixed-width logo) and mitigated with `flexShrink`/`numberOfLines` truncation — but this is a code-level mitigation, not a device-verified fix. **No physical Android device or emulator was available in this environment**, so 320/360/412dp widths and font scale 1.0/1.3 remain unverified on real hardware.
