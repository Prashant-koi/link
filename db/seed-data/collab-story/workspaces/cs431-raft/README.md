# CS 431 — Raft Key-Value Store

**Team:** John Doe, Nina Farouk, Amara Okafor  
**Advisor/Instructor:** [Course Staff]  
**Started:** Mon 27 Jul 2026  
**Last updated:** Fri 18 Sep 2026

## Goal

Implement a fault-tolerant key-value store in Go using the Raft consensus algorithm. The system must handle leader elections, log replication, and (by Milestone 3) snapshotting and linearizability testing under network partitions and process crashes.

## Team Roles

| Member | Responsibilities |
|---|---|
| **Nina Farouk** | Leader election logic, design doc, overall coordination |
| **John Doe** | Log replication, state machine application, integration with KV store |
| **Amara Okafor** | Test harness, Jepsen-style fault injector, linearizability checks |

## Status (as of Fri 18 Sep)

- ✅ Leader election implemented and stable.
- ✅ Log replication working across 3–5 node clusters.
- ✅ **Bug fixed:** Split votes after partition heal. Root cause was deterministic election timeouts; fixed by randomising timeouts in the range **150–300 ms**. This eliminated the repeated tie-break failures we saw in the `partition_heal` test suite.
- ⏳ Snapshotting: in progress, target completion by **Wed 23 Sep**.
- ⏳ Linearizability tests: Amara is wiring up the fault injector; first runs expected **Thu 24 Sep**.

## Milestones

| Milestone | Due Date | Status |
|---|---|---|
| M1: Basic Raft (election + replication) | Fri 15 Aug | ✅ Done |
| M2: Persistence + log compaction | Fri 29 Aug | ✅ Done |
| **M3: Snapshotting + linearizability tests** | **Wed 30 Sep** | 🔄 In progress |
| Final report + live demo | **Fri 9 Oct** | ⏳ Planned |

## Build & Run

```bash
# Clone
git clone git@github.com:<team>/cs431-raft-kv.git
cd cs431-raft-kv

# Build
go build -o raft-kv ./cmd/raft-kv

# Run a 3-node cluster locally (uses ports 8001–8003)
./scripts/start_cluster.sh --nodes 3

# Run tests
go test ./... -v -count=1

# Run fault-injection suite (requires cluster running)
./scripts/fault_test.sh --scenarios partition_heal,leader_crash,split_vote
```

### Environment

- **Go 1.22+**
- No external dependencies beyond the standard library and `github.com/pmezard/go-difflib` (for diffing test outputs).
- All state is stored on local disk under `./data/<node_id>/`.

## Testing

Amara's fault injector simulates:
- Network partitions (selective drop between nodes)
- Process crashes and restarts
- Message reordering and delay (up to 500 ms)

Linearizability is checked by issuing concurrent read/write operations and verifying the linearisable history using a simplified Jepsen-style checker.

```bash
# Quick smoke test
go test ./internal/raft/... -run TestElectionStability -v

# Full M3 test suite (takes ~5 min)
./scripts/fault_test.sh --scenarios all --report test_report.html
```

## Known Issues / TODOs

- [ ] Snapshot restore after cluster restart still loses in-flight log entries (John investigating).
- [ ] Election timeout randomisation range (150–300 ms) may need tuning for 5-node clusters; currently stable at 3 nodes.
- [ ] Amara: add a `--chaos-interval` flag to the fault injector for continuous random failures.
- [ ] Nina: finalise design doc sections on snapshot format and linearizability assumptions.

## Repo Structure

```
cs431-raft-kv/
├── cmd/raft-kv/          # Main entrypoint
├── internal/
│   ├── raft/             # Core Raft implementation (election, replication)
│   ├── kv/               # Key-value state machine
│   ├── snapshot/         # Snapshotting logic (M3)
│   └── test/             # Fault injector + linearizability checker
├── scripts/
│   ├── start_cluster.sh
│   └── fault_test.sh
├── data/                 # Local node state (gitignored)
├── go.mod
└── README.md
```

## Notes

- We deliberately avoided external Raft libraries to keep the implementation transparent for grading.
- All inter-node communication uses TCP with a simple length-prefixed JSON protocol.
- For the demo on 9 Oct, we plan to show: (1) normal operation, (2) a partition + heal cycle, (3) a leader crash and re-election, (4) snapshot restore after data loss.

---
*Last updated by Nina Farouk, Fri 18 Sep 2026.*
