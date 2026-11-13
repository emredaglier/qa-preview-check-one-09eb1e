---
symptom: Gate documents keep saying "CI green on the build under review: not met" because only the pull requests' CI result was ever reported
detail: Agents report CI green on the pull request. Nobody reports the run on main after the merge, so the criterion "CI check and browser green on the merged build" stayed unmet at both G4 and G5 and went to the owner as a known gap. When cutting the last ticket before a gate, have the lead report the main run for the merge commit (commit id plus pass or fail) in the hand-off, and ask for it with a handoff message before writing the gate document. Then the gate either shows the result or says why it is missing.
cause: observed
fix-verified: Not verified. The fix was not applied in this project. The evidence is that G4-1 and G5-1 both carry the CI-on-main criterion unchecked, with only PR results reported.
date: 2026-11-13
form: rule
source: gate G4-1, gate G5-1 (main at ebda19a)
principle: A gate criterion needs a named source of evidence and someone asked to produce it before the gate is written
applies-to: general
---
