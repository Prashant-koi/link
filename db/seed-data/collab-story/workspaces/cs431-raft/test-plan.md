# CS 431 — Raft KV Store: Test Plan

**Owner:** Amara Okafor
**Last updated:** Sat 12 Sep 2026
**Status:** Active. We are using this to prep for Milestone 3 (due Wed 30 Sep).

## 1. Scope & Strategy
We are not just testing happy paths. The goal is to prove **linearizability** under network partitions and process crashes.
*   **Unit Tests:** Go `testing` package. Fast, deterministic.
*   **Integration/Chaos:** Custom fault injector + linearizability checker. Slow, non-deterministic (mostly).

## 2. Test Layers

### A. Unit Tests (Deterministic)
*   **Log Compaction:** Verify snapshot application restores state correctly.
*   **Leader Election:**
    *   *Case:* Split vote scenario (3 nodes, two partitions).
    *   *Expectation:* No leader elected until partition heals.
    *   *Fix Note:* We randomize election timeouts (150–300ms) to prevent persistent split votes after heal. This is now a hard requirement in the test suite.
*   **AppendEntries:** Verify log matching property. If node B has entry `N` from leader A, it must match node A’s entry at `N`.

### B. Fault Injector (Chaos Monkey Lite)
Implemented as a middleware wrapper around the gRPC transport layer.
*   **Drop:** Randomly drop packets (configurable %).
*   **Delay:** Add Gaussian jitter to request/response times.
*   **Partition:** Isolate a subset of nodes (e.g., Node 1 sees Nodes 2 & 3; Nodes 2 & 3 see each other but not Node 1).
*   **Kill:** `SIGKILL` a random node, restart after `T` ms.

**Usage:**
```go
// Example: 10% packet loss, 50-200ms latency
injector := fault.NewInjector(
    fault.WithDropRate(0.1),
    fault.WithLatency(time.Duration(50)*time.Millisecond, time.Duration(200)*time.Millisecond),
)
client := injector.Wrap(originalClient)
```

### C. Linearizability Checker
We record all client operations (put/get) with timestamps and compare against a sequential history.
*   **Tool:** We are writing a simple checker in Go (no external deps yet). If it gets complex, we’ll switch to Jepsen or a Python script.
*   **Record Format:** JSON lines: `{"ts": 1234567890, "op": "put", "key": "k1", "val": "v1", "node": 1}`

## 3. Chaos Scenarios (Milestone 3 Focus)
| ID | Scenario | Pass Criteria |
|----|----------|---------------|
| C1 | Partition Leader from Follower | Followers elect new leader; no data loss on heal. |
| C2 | Kill Leader during AppendEntries | New leader elected; log consistency maintained. |
| C3 | Network Delay (500ms) | Throughput drops, but no incorrect reads. |
| C4 | Split-Brain (2 vs 1 nodes) | Minority partition rejects writes. Majority accepts. |
| C5 | Snapshot + Crash | Node restarts from snapshot; state matches peers. |

## 4. Pass Criteria
1.  **Zero Linearizability Violations:** The checker must return `OK` for all runs.
2.  **No Data Loss:** All acknowledged writes must be readable after recovery.
3.  **Liveness:** System recovers from any single-node failure within < 5s (election timeout + replication).

## 5. Known Issues & Flakies
*   **Flaky Test:** `TestLeaderElection_SplitVoteHeal`
    *   **Symptom:** Occasionally fails with "two leaders elected."
    *   **Root Cause:** Deterministic timeouts caused synchronized retries.
    *   **Fix (Applied):** Randomized election timeout range (150–300ms). Monitor for regression.
*   **TODO:** The linearizability checker is currently O(N²) for large histories. Need to optimize if we run >10k ops.

## 6. Execution Plan
*   **Daily:** Run unit tests + C1-C2 on `main` branch (CI).
*   **Pre-Milestone 3:** Full chaos suite (C1-C5) x 10 iterations.
*   **Reporting:** Any failure generates a `trace.log` with full message sequences.

---
*Amara: If you find a race condition, tag me. Don’t just "fix" it by adding sleep. We need to understand the protocol violation.*
