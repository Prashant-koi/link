# CS 431 — Raft Key-Value Store: Design Doc

**Team:** John Doe, Nina Farouk, Amara Okafor
**Last updated:** Fri 11 Sep 2026

## Overview
We are implementing a fault-tolerant key-value store using the Raft consensus algorithm. The system must survive node failures and network partitions while maintaining linearizability for client writes. This document covers the architecture, RPC protocol, state management, and client interface.

## Architecture
- **Language:** Go 1.21
- **Transport:** TCP with JSON-encoded messages.
- **Nodes:** Each node runs a single Raft instance managing one log.
- **State Machine:** A simple in-memory map (`map[string]string`) persisted to disk on every committed command.

## Persistent vs. Volatile State
**Persistent (must survive restarts):**
- `currentTerm`: The latest term the node has seen.
- `votedFor`: Candidate ID that this node voted for in the current term, or null.
- `log[]`: Sequence of log entries. Each entry contains a command (`{op: "SET", key: ..., value: ...}`) and its associated `term` and `index`.

**Volatile (can be lost on crash):**
- `state`: One of `Follower`, `Candidate`, `Leader`.
- `leaderId`: The identity of the current leader as seen by this node.

## RPCs

### 1. RequestVote
Sent by Candidates to gather votes.
```go
type RequestVote struct {
    Term        int    `json:"term"`
    CandidateID string `json:"candidate_id"`
    // Leader completeness check:
    LastLogIndex int   `json:"last_log_index"`
    LastLogTerm  int   `json:"last_log_term"`
}

type RequestVoteResponse struct {
    Term        int  `json:"term"`
    VoteGranted bool `json:"vote_granted"`
}
```
**Voting Rules:**
1. If `request.Term < currentTerm`, deny immediately.
2. If `votedFor` is null or equals `candidateID`, AND the candidate’s log is at least as up-to-date as the receiver’s log, grant vote.
   - "Up-to-date" means: higher `LastLogTerm`, or if equal, higher `LastLogIndex`.

### 2. AppendEntries
Sent by Leader to replicate log entries and maintain heartbeats.
```go
type AppendEntries struct {
    Term            int    `json:"term"`
    LeaderID        string `json:"leader_id"`
    PrevLogIndex    int    `json:"prev_log_index"`
    PrevLogTerm     int    `json:"prev_log_term"`
    Entries         []LogEntry `json:"entries"` // may be empty for heartbeat
    LeaderCommit    int    `json:"leader_commit"`
}

type AppendEntriesResponse struct {
    Term         int  `json:"term"`
    Success      bool `json:"success"`
    MatchIndex   int  `json:"match_index"` // highest index that matches leader’s log
}
```
**Consistency Check:**
- If `request.Term < currentTerm`, deny.
- If `PrevLogIndex` is not in our log, or `log[PrevLogIndex].term != PrevLogTerm`, deny. Leader must back up `nextIndex` and retry.
- If successful, append new entries (overwriting conflicts) and advance `commitIndex`.

### 3. InstallSnapshot
Used when a follower’s log is too far behind for `AppendEntries` to catch up.
```go
type InstallSnapshot struct {
    Term         int    `json:"term"`
    LeaderID     string `json:"leader_id"`
    LastIndex    int    `json:"last_index"`   // index of last entry in snapshot
    LastTerm     int    `json:"last_term"`    // term of last entry in snapshot
    Data         []byte `json:"data"`         // serialized state machine snapshot
}

type InstallSnapshotResponse struct {
    Term    int  `json:"term"`
    Success bool `json:"success"`
}
```
**Handling:**
- If `request.Term < currentTerm`, deny.
- Otherwise, truncate any conflicting log entries after `LastIndex`, apply the snapshot to the state machine, and update `lastApplied`.

## Leader Election
- **Timeouts:** Randomized between **150 ms and 300 ms**. This prevents split votes when multiple nodes time out simultaneously.
- **Process:**
  1. On timeout, node transitions to `Candidate`, increments `currentTerm`, votes for itself.
  2. Sends `RequestVote` to all peers.
  3. If it receives a majority of votes (including its own), it becomes `Leader` and starts sending heartbeats.
  4. If it receives a higher term in any response, it reverts to `Follower`.

## Log Replication Rules
1. Leader appends new client commands to its log locally.
2. Leader sends `AppendEntries` to all followers in parallel.
3. Once a majority of nodes have replicated the entry (including the leader), the leader marks it as committed and applies it to the state machine.
4. The leader includes `leaderCommit` in subsequent heartbeats so followers can advance their `commitIndex`.

## Snapshotting
- **Trigger:** Every 1,000 committed log entries, or when the log exceeds 10 MB (whichever comes first).
- **Process:**
  1. Leader serializes its state machine into a compact snapshot.
  2. Truncates the log up to the snapshot’s `lastIndex`.
  3. If a follower needs entries before the snapshot, leader sends `InstallSnapshot` instead of `AppendEntries`.

## Client Interface
```go
type KVStore interface {
    Set(key string, value string) error
    Get(key string) (string, error)
}
```
- **Exactly-Once Semantics:** Clients assign a unique `requestID` to each write. The leader deduplicates requests by `requestID` within the current term. If a client retries after a timeout, the leader recognizes the duplicate and returns the original result without re-applying the command.
- **Reads:** Reads are served from the state machine. For linearizability, we use lease-based reads (leader checks if it is still leader by ensuring no new votes were received in the last `electionTimeout/2`) or read index protocol. We will implement **read index** for correctness without blocking writes.

## Testing Strategy (Amara)
- Unit tests for each RPC handler.
- Integration tests with 3 and 5 nodes.
- Fault injection: kill leader, partition network, restart nodes.
- Jepsen-style consistency checks using a custom CLI tool that issues concurrent reads/writes and verifies linearizability.

## Open Questions / TODOs
- [ ] Decide on exact serialization format for snapshots (JSON vs. gob).
- [ ] Implement `InstallSnapshot` fully (currently stubbed).
- [ ] Add metrics endpoint for monitoring election timeouts and commit latency.
- [ ] Write design doc section on read index protocol details.

---
*Note: This doc is a living document. Please update it as we make changes to the architecture.*
