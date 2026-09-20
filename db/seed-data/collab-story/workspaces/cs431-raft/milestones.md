# CS 431 — Raft KV Store: Milestones

**Team:** John Doe, Nina Farouk, Amara Okafor
**Last updated:** Fri 18 Sep 2026 by Nina

## Status Overview

| Milestone | Due Date | Status | Owner(s) |
| :--- | :--- | :--- | :--- |
| M1: Leader Election | Done | ✅ Complete | Nina |
| M2: Log Replication | Done | ✅ Complete | John |
| M3: Snapshotting + Linearizability | Wed 30 Sep | 🟡 In Progress | Amara, John, Nina |
| Final Report + Demo | Fri 9 Oct | ⬜ Not Started | All |

## M1: Leader Election (DONE)

**Completed:** ~Week 6
**Owner:** Nina

*   Implemented Raft leader election with randomized timeouts.
*   **Key Fix:** We had a nasty bug where split votes occurred after a network partition healed. Fixed by randomizing election timeouts in the range **150–300 ms**. This prevented two nodes from consistently choosing the same candidate simultaneously during reconnection.
*   Design doc written and reviewed by Prof. Petrov (she’s also our paper advisor, so she was strict about the terminology).

## M2: Log Replication (DONE)

**Completed:** ~Week 8
**Owner:** John

*   Basic log replication is working. Nodes can append entries and commit when a majority acks.
*   John handled the core state machine transitions here.
*   **Note:** We are using Go for this project, separate from the Link app stack (Node/TS). Don’t mix up the repos!

## M3: Snapshotting + Linearizability Tests (IN PROGRESS)

**Due:** Wed 30 Sep 2026
**Owners:** Amara (tests), John (snapshot logic), Nina (coordination)

This is the heavy one. We need to ensure the KV store remains linearizable even when nodes crash or lose their log history.

### Sub-tasks:
- [ ] **Snapshotting Mechanism:**
    - [ ] Implement `InstallSnapshot` RPC.
    - [ ] Handle state machine compaction (discard old log entries after snapshot).
    - [ ] *Owner:* John (mostly done, needs edge case testing for large snapshots).
- [ ] **Linearizability Tests:**
    - [ ] Amara is building the Jepsen-style fault injector.
    - [ ] Need to verify that reads/writes return consistent values even with concurrent requests during leader changes.
    - [ ] *Status:* Injector skeleton is up; test cases for "split-brain" scenarios are being written.
- [ ] **Integration:**
    - [ ] Run full cluster simulation with 5 nodes, kill 2 at random intervals.
    - [ ] Verify no data loss or duplication.

**Risks:**
*   Amara’s fault injector is still a bit flaky on the timing front. We need to make sure our test failures aren’t due to race conditions in the *tests* rather than the implementation.
*   John is juggling this with the Link app auth hardening (due 23 Sep), so if we slip, it’s likely because of that.

## Final: Report + Demo

**Due:** Fri 9 Oct 2026
**Owners:** All

*   **Report:** Needs to cover the design decisions, especially the election timeout randomization (M1) and how snapshotting interacts with log compaction (M3).
*   **Demo:** Live coding session showing a 5-node cluster surviving a partition. Amara will drive the fault injector live.

## Notes & TODOs

*   [ ] **Nina:** Draft the "Design Decisions" section of the final report. Focus on why we chose Raft over Paxos (simplicity, our experience).
*   [ ] **John:** Ensure the snapshot code is clean before 30 Sep. No hacky workarounds left in the commit history.
*   [ ] **Amara:** Get the linearizability test suite passing locally by 25 Sep so we have a full week of buffer for debugging.
*   [ ] **All:** Sync up on Tue 22 Sep to review M3 progress.

---
*Reminder: This is a course project. Keep it separate from the Link hackathon codebase. Different languages, different tools.*
