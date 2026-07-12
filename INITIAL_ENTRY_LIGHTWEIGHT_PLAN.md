# 2nd Optimization Execution Plan v4

## Goal

This round focuses on initial entry lightweighting, not broad module surgery.

Execution order:

1. Measure first
2. Identify bottlenecks
3. Prioritize by impact score
4. Remove initial import cost
5. Apply safe lazy loading to low-risk targets
6. Optimize CSS
7. Optimize images
8. Roll out gradually with gates

## Scope

Included:

1. Frontend entry-path optimization
2. Safe module loading changes for low-risk slices
3. CSS cleanup and staged delivery
4. Image delivery optimization
5. Measurement, reporting, and rollout gates

Excluded from structural change in this round:

1. Briefing architecture changes
2. Calendar architecture changes
3. Backend redesign
4. State framework replacement
5. Design system overhaul

Briefing and calendar remain measurement targets only during this round because they already span Redis, Gemini, Supabase, Google Calendar, and client-side orchestration.

## Execution Principles

1. No optimization without baseline evidence.
2. Improvement rate and absolute budgets must both pass.
3. Dynamic import targets are selected by impact score, not by feature name.
4. One phase at a time. No cross-feature mass split.
5. Every phase needs explicit exit gates before the next phase starts.

## Day 0: Baseline and Mapping

### Day 0 Deliverables

1. Initial import dependency map
2. Initialization dependency map
3. Bundle analysis report
4. Duplicate module report
5. Network waterfall captures
6. Coverage snapshot
7. Lighthouse snapshot
8. Memory snapshot
9. Initial entry hotspot ranking
10. Dynamic import candidate ranking

### Day 0 Metrics To Collect

1. Initial JS transfer size
2. Initial JS parse and compile time
3. FCP
4. LCP
5. INP
6. TBT
7. Initial request count
8. Initial CSS transfer size
9. Image transfer size by category
10. Cache hit rate for key flows
11. Heap growth across navigation
12. Detached DOM count
13. Listener count by major feature
14. Long task count and duration

### Day 0 Reports To Produce

1. Baseline report
2. Duplicate module report
3. Initialization dependency map
4. Import dependency map
5. Top 5 bottleneck list

## Performance Budgets

These are provisional budgets. Final values are locked after Day 0 measurement.

### Global Entry Budgets

1. Initial JS transfer: <= 350 KB
2. Initial JS parse and compile: <= 500 ms
3. LCP: <= 2.5 s
4. INP: <= 200 ms
5. TBT: <= 150 ms
6. Initial request count: reduce by at least 20 percent from baseline
7. Initial image transfer: reduce by at least 40 percent from baseline

### Module Chunk Budgets

1. Entry bundle: <= 150 KB
2. Notebook chunk: <= 120 KB
3. Chat chunk: <= 100 KB
4. Calendar chunk: <= 80 KB
5. Editor chunk: <= 120 KB
6. Persona chunk: <= 80 KB unless measurement proves a higher justified budget

Budgets are enforced both by file size and by first-use interaction cost.

## Acceptance Rules For Lazy Loading

Lazy loading is accepted only if all of the following are true:

1. Initial entry metrics improve measurably
2. First use after lazy import completes in <= 500 ms on the agreed test profile
3. No initialization race causes undefined state, failed binding, or missing UI
4. Import failure has a user-safe fallback or retry path
5. Feature regressions remain at zero in the guarded flow

If first use becomes noticeably slow, the lazy split fails even if the initial bundle shrinks.

## Impact Score For Candidate Selection

Dynamic import candidates are ranked using impact score rather than fixed feature order.

Impact score factors:

1. Initial loading weight
2. Parse and compile cost
3. Execution frequency on first visit
4. Real user feature frequency
5. Dependency fan-out
6. Initialization ordering risk
7. Fallback complexity

Prioritization rule:

1. High impact and low risk targets first
2. High impact and high coupling targets delayed until structure is mapped
3. Briefing and calendar excluded from structural changes in this round

## Phase Plan

### Phase A: Measurement Only

Actions:

1. Produce all Day 0 reports
2. Lock final budgets
3. Rank top bottlenecks and lazy-load candidates

Exit gate:

1. Baseline capture complete
2. Top 5 bottlenecks identified
3. Duplicate module report complete
4. Initialization dependency map complete

### Phase B: Initial Import Removal

Actions:

1. Remove entry-path imports that are not required for first paint
2. Defer non-essential setup until after initial render or user interaction
3. Reduce work inside DOMContentLoaded and equivalent boot paths

Exit gate:

1. Initial render regressions: 0
2. JS parse improvement is measurable
3. No auth, theme, or core state boot failures

### Phase C: Safe Lazy Loading For Low-Risk Targets

Actions:

1. Split only top-ranked low-risk candidates
2. Add readiness guards and idempotent event binding
3. Add fallback path for failed lazy import

Exit gate:

1. First-use latency stays within acceptance rule
2. No race-condition regression
3. Lazy-loaded feature passes targeted interaction checks

### Phase D: CSS Cleanup

Actions:

1. Remove duplication
2. Remove unused rules
3. Consider critical CSS only after earlier cleanup is stable

Exit gate:

1. FOUC incidents: 0
2. Theme token timing remains stable
3. No visual regression in key screens

### Phase E: Image Optimization

Actions:

1. Optimize by category: hero, background, avatar, icon, emotion
2. Apply WebP or AVIF where practical
3. Apply lazy loading, responsive sizing, preload priorities, and cache policy

Exit gate:

1. LCP improvement confirmed
2. No visible quality regression in reviewed assets
3. Initial image transfer reduction confirmed

### Phase F: Canary and Rollout

Actions:

1. Release by feature flag or scoped deployment unit
2. Verify production telemetry
3. Roll back by phase if error rate rises

Exit gate:

1. Error rate does not increase
2. Core user flows remain stable
3. Performance gains persist outside local testing

## CSS Strategy

Order is fixed to reduce risk:

1. Remove duplicate CSS
2. Remove unused CSS
3. Evaluate critical CSS only if theme and stitch token timing remain stable

This is necessary because Tailwind, direct CSS, dynamic theme variables, and Stitch token injection currently coexist.

## Image Strategy

Image optimization is not a single-format conversion task.

Per-category approach:

1. Hero: preload candidate review, high quality WebP or AVIF, responsive sizes
2. Background: compression, lazy where possible, cache-control tuning
3. Avatar: responsive sizing, lazy for non-critical views
4. Icon: evaluate sprite or vector alternatives where appropriate
5. Emotion image: compress and lazy-load outside first paint

## Memory and Leak Checks

Performance review must include memory stability, not only speed.

Required checks:

1. Heap growth during repeated navigation
2. Detached DOM accumulation
3. Listener count growth after repeated open and close flows
4. Re-initialization side effects after lazy-loaded module reuse

## Current Snapshot Started During Planning

The following current-state observations are already confirmed and should seed Phase A:

1. [public/index.html](public/index.html) currently includes 16 script tags across inline boot logic, CDN libraries, vendor files, and module entrypoints.
2. [public/app.js](public/app.js) currently has 7 top-level static import statements, including state and 6 feature-level imports.
3. Current large entry-adjacent frontend files include:
   - [public/index.html](public/index.html)
   - [public/style.css](public/style.css)
   - [public/modules/chat/chatUI.js](public/modules/chat/chatUI.js)
   - [public/modules/notebook/notebookUI.js](public/modules/notebook/notebookUI.js)
   - [public/modules/notebook/notebookList.js](public/modules/notebook/notebookList.js)
   - [public/app.js](public/app.js)
4. Large static image assets remain a major first-load risk and must be measured by category, not only by file extension.

## Immediate Next Actions

1. Produce the Day 0 baseline report from the current entry path
2. Build the import and initialization dependency maps
3. Rank feature candidates by impact score before any lazy split is attempted
4. Confirm which modules truly belong in the initial entry bundle

## Definition of Done

This optimization round is complete only when:

1. Day 0 evidence exists and is stored
2. Phase gates A through F are passed in order
3. Absolute performance budgets are met or explicitly re-baselined with justification
4. Improvement metrics are demonstrated with before and after evidence
5. No critical regressions appear in core user flows
6. Briefing and calendar remain stable while excluded from structural change in this round