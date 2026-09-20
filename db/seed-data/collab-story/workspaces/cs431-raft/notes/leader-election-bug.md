# Leader Election Bug: Split Votes After Partition Heal

**Status:** Fixed & verified  
**Opened:** Sat 15 Aug 2026 (Nina)  
**Closed:** Tue 18 Aug 2026 (Nina)  
**Affected component:** `raft/election.go`  

---

## TL;DR
After a network partition heals, two nodes would simultaneously believe they were leader for ~150ms. Clients saw duplicate writes and inconsistent reads until the next heartbeat cycle resolved it. Root cause was **fixed election timeouts** + **not resetting the timer on valid AppendEntries**. Fix: randomised timeouts (150–300 ms) + proper timer reset.

---

## Symptom
Amara’s fault injector (`tests/fault_injector.go`) would:
1. Run a 5-node cluster, elect leader (node 2).
2. Partition node 2 from the rest for 5s.
3. Heal the partition.
4. Observe: nodes 1 and 3 both entered `Leader` state within the same heartbeat window. Node 3 had already committed a log entry that node 2 then rejected because its term was higher.

Repro rate: ~70% with fixed 200ms timeouts. Rarely reproduced in manual testing, which is why it slipped past milestone 1.

## Root Cause (two compounding issues)

### 1. Fixed election timeout
All nodes used `electionTimeout = 200ms`. After partition heal, every follower’s timer had been ticking independently for the same duration. When the partition healed, multiple timers expired in the same millisecond slice → simultaneous `StartElection()` calls → split vote (each got 1 of 5 votes; neither reached majority).

### 2. Timer not reset on valid AppendEntries
Per the Raft paper (§5.2), a follower should reset its election timer when it receives a *valid* AppendEntries from the current leader. Our implementation only reset the timer if `leaderID == self.currentLeader`. After partition heal, a follower might receive AppendEntries from a *different* node that hasn’t yet been confirmed as leader (stale or competing), and we ignored the reset. This let the timer keep ticking toward expiry even though a legitimate leader was actively sending heartbeats.

## Fix (commit `a4f2c1e`)

```go
// election.go
const (
    minElectionTimeout = 150 * time.Millisecond
    maxElectionTimeout = 300 * time.Millisecond
)

func (r *RaftNode) randomizeElectionTimeout() {
    jitter := time.Duration(rand.Int63n(int64(maxElectionTimeout - minElectionTimeout)))
    r.electionTimeout = minElectionTimeout + jitter
}

// Called in StartElection and on every valid AppendEntries/RequestVoteAck
func (r *RaftNode) resetElectionTimer() {
    r.timer.Reset(r.electionTimeout)
}
```

Changes:
- `randomizeElectionTimeout()` called once at node startup and re-called after each election round.
- `resetElectionTimer()` now triggered on **any** valid AppendEntries (term ≥ current, log up-to-date check passes), not just from the tracked leader.
- Added `lastResetAt` timestamp to avoid re-randomising mid-heartbeat-window.

## Verification
- Ran Amara’s injector 50x with fixed seed: **0 split votes** across all runs.
- Jepsen-style linearizability test (Amara): 10k ops, 0 anomalies.
- Manual partition/heal cycle x20: stable.

## Lessons / TODOs for Milestone 3
- [ ] Add a unit test that explicitly asserts "timer resets on AppendEntries from non-tracked leader" — this was the subtle part.
- [ ] Consider whether we need term-based tie-breaking in `RequestVote` response (currently rely on log up-to-date check; works but worth documenting).
- [ ] Amara: extend fault injector to do *asymmetric* partitions (e.g., 2 nodes isolated, not just 1) before milestone 3 deadline (Wed 30 Sep).
- [ ] Nina: write this up in the design doc §4.3 "Election Timing" so the team doesn’t re-introduce fixed timeouts during snapshot work.

## References
- Raft paper §5.2 (leader election), §5.2.1 (election safety)
- Our design doc draft: `docs/design.md` §4 (Nina, last updated Mon 17 Aug)
