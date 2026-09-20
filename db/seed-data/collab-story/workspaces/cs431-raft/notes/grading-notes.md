# Grading Notes — CS 431 Raft KV Store

*Last updated: Mon 31 Aug 2026*
*Sources: Course syllabus rubric, TA office hours (Wed 26 Aug), Prof. Petrov's lecture notes on linearizability.*

## What the Graders Actually Check

Based on last semester’s feedback and the TA’s comments in office hours, grading is heavily weighted toward **correctness under failure**, not just "it works on my machine."

### 1. Correctness Under Partition (40%)
- **Split-brain detection**: Does the cluster handle a network partition correctly? We need to show that only one leader exists at any time.
- **Log consistency**: After a partition heals, do all nodes have identical committed logs?
- **Our current status**: 
  - Leader election: ✅ Done (randomized timeouts 150–300ms fixed the split-vote bug).
  - Log replication: ✅ Working (John’s implementation).
  - Partition tests: ⚠️ Amara’s Jepsen-style injector is ready, but we haven’t run the full suite yet. *TODO: Run before Milestone 3 deadline.*

### 2. Snapshot Handling (20%)
- **Compaction**: Does the leader compact its log when it grows too large?
- **Follower catch-up**: Can a lagging follower install a snapshot and then apply subsequent entries?
- **Edge case**: What if a follower is *far* behind? Does the leader send the full snapshot or just the last N entries? (Rubric says: must handle both.)
- **Our current status**: 
  - Snapshot generation: ✅ Basic implementation done.
  - Snapshot installation on followers: ❌ Not started yet. *This is Milestone 3’s main focus.*

### 3. Report Quality (20%)
- **Clarity**: Explain *why* we made design choices, not just *what* we did.
- **Evidence**: Include logs, test outputs, and failure scenarios.
- **Honesty**: If something doesn’t work, say so and explain the tradeoff.
- **Our current status**: 
  - Nina (me) is writing the design doc.
  - John will contribute sections on log replication.
  - Amara will add test results.
  - *TODO: Draft outline by Fri 4 Sep.*

### 4. Code Quality & Testing (20%)
- **Modularity**: Is the code easy to read and maintain?
- **Testing**: Are there unit tests for critical paths? Integration tests for failure scenarios?
- **Our current status**: 
  - Unit tests: ✅ Basic coverage done.
  - Integration tests: ⚠️ Amara’s fault injector is ready, but we need to wire it into the test suite.

## Points Breakdown (Total: 100)

| Category | Points | Status |
|----------|--------|--------|
| Correctness under partition | 40 | In progress |
| Snapshot handling | 20 | Not started |
| Report quality | 20 | Drafting |
| Code quality & testing | 20 | In progress |

## Final Report Checklist

- [ ] Introduction: Problem statement, scope, team roles.
- [ ] Design: Architecture diagram, key decisions (why Raft? why Go?).
- [ ] Implementation: How leader election, log replication, and snapshots work.
- [ ] Testing: Failure scenarios, test results, known limitations.
- [ ] Evaluation: Performance under load, latency, throughput.
- [ ] Conclusion: What we learned, future work.
- [ ] References: Raft paper, Jepsen docs, any other sources.

## Open Questions for TA / Prof.

1. **Snapshot granularity**: Should we send the full snapshot or just the last N entries to followers? (TA said: "Start with full, optimize later if time permits.")
2. **Linearizability tests**: Do we need to prove linearizability formally, or is it enough to show that reads/writes are consistent under partition? (TA said: "Show consistency; formal proof is a bonus.")
3. **Demo expectations**: What should the demo look like? (TA said: "Show a partition, then heal it, and show that the cluster recovers correctly.")

## Timeline

- **Wed 30 Sep**: Milestone 3 (snapshotting + linearizability tests) due.
- **Fri 9 Oct**: Final report + demo due.

## Team Responsibilities

- **John**: Log replication, performance tuning.
- **Nina** (me): Leader election, design doc, report structure.
- **Amara**: Testing, fault injector, test results.

*Note: We need to coordinate closely on the snapshot implementation. John and Amara should pair on this next week.*
