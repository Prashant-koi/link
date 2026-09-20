// snapshot.go — Raft snapshotting logic (CS 431)
//
// Nina: I'm driving the "when to snapshot" and the RPC surface here.
// John: you own applying a snapshot to the log (InstallSnapshot). I've left
//       big TODO markers where your code needs to slot in before Milestone 3.
// Amara: please add the linearizability + fault-injection tests against this
//       once it's stubbed out.
//
// Last touched: Fri 18 Sep 2026 (Nina)

package raft

import (
	"context"
	"encoding/gob"
	"fmt"
	"log"
	"sync"
)

const (
	// snapshotEvery is how many committed entries we let accumulate before
	// forcing a snapshot. 1000 is what the spec suggested; we can tune it
	// later if Amara's tests show the log gets too long in her fault runs.
	snapshotEvery = 1000

	// maxLogSize is a hard cap we also check. If the log exceeds this many
	// entries we snapshot immediately, even if we haven't hit snapshotEvery.
	maxLogSize = 5000
)

// Snapshot represents the state of the KV store at a given commit index.
// We serialize this with gob so it's easy to persist to disk and ship over
// the wire in InstallSnapshot RPCs.
type Snapshot struct {
	LastIndex  uint64            // commit index this snapshot reflects
	Term       uint64            // term of the leader when snapshotted
	KV         map[string]string // full KV state at LastIndex
}

// Snapshotter is the interface we expose so tests can mock it out.
type Snapshotter struct {
	mu      sync.Mutex
	store   KVStore     // interface, defined in kv.go (Nina)
	raft    *Raft       // back-ref for getting commit index / term
	enabled bool
}

func NewSnapshotter(store KVStore, raft *Raft) *Snapshotter {
	s := &Snapshotter{
		store:   store,
		raft:    raft,
		enabled: true,
	}
	gob.Register(&Snapshot{})
	return s
}

// MaybeSnapshot is called after each commit. If we've crossed the threshold,
// we take a snapshot and compact the log.
func (s *Snapshotter) MaybeSnapshot(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.enabled {
		return nil
	}

	commitIndex := s.raft.CommitIndex()
	logLen := s.raft.LogLen()

	shouldSnapshot := logLen >= snapshotEvery || logLen >= maxLogSize
	if !shouldSnapshot {
		return nil
	}

	log.Printf("[snapshot] taking snapshot at commitIndex=%d logLen=%d", commitIndex, logLen)

	// 1. Capture the current KV state. We do this under our own lock so we
	//    get a consistent view. (John: confirm this is safe w.r.t. your
	//    concurrent Apply loop — I think it's fine because Apply only mutates
	//    via the same store interface, but flag if I'm wrong.)
	snap := &Snapshot{
		LastIndex: commitIndex,
		Term:      s.raft.CurrentTerm(),
		KV:        s.store.Snapshot(), // returns a deep copy
	}

	// 2. Persist to disk (best effort; we can retry on next boot).
	if err := persistSnapshot(snap); err != nil {
		log.Printf("[snapshot] WARN: failed to persist snapshot: %v", err)
		// Don't fail the whole commit path — just log and try again later.
		return fmt.Errorf("persist snapshot: %w", err)
	}

	// 3. Compact the log. This is where John's work comes in.
	//
	// TODO(john): Implement compactLog(snap). It should:
	//   - Truncate all log entries with index <= snap.LastIndex
	//   - Update baseLogIndex to snap.LastIndex
	//   - Ensure the next log entry (if any) has a valid Term
	//   - Be safe even if called concurrently with AppendEntries (use the
	//     same lock as your log, or document why it's fine)
	//
	// I'll wire this in once you push. For now we just log so Amara can see
	// that we *would* have compacted.
	log.Printf("[snapshot] TODO(john): compactLog not yet implemented — skipping")

	return nil
}

// InstallSnapshotRPC is the handler for a follower receiving a snapshot from
// the leader. This is the big one John needs to fill in.
//
// Protocol (per our design doc, section 5.3):
//   - Leader sends Snapshot{LastIndex, Term, KV} when the follower's log is
//     too far behind for normal AppendEntries.
//   - Follower applies the snapshot atomically: swap KV state, reset log to
//     start at LastIndex+1, update commit index if needed.
//   - Follower responds with success + its new commit index so leader can
//     resume sending entries.
func (s *Snapshotter) InstallSnapshotRPC(ctx context.Context, req *InstallSnapshotRequest) (*InstallSnapshotResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// TODO(john): Validate the request:
	//   - If req.Term < currentTerm, reject (standard Raft rule).
	//   - If req.Snapshot.LastIndex <= our last log index, we're already up to
	//     date — respond OK with no work.
	//   - If req.Snapshot.LastIndex > our last log index, we need to apply.

	// TODO(john): Apply the snapshot:
	//   1. s.store.Load(req.Snapshot.KV)  // atomic swap under store lock
	//   2. s.raft.ResetLogForSnapshot(req.Snapshot.LastIndex, req.Snapshot.Term)
	//      (new method on Raft — you'll add it)
	//   3. If req.Snapshot.LastIndex > s.raft.CommitIndex(), update commit index
	//   4. Return {Success: true, CommitIndex: newCommitIndex}

	// For now, stub so the RPC interface compiles and Amara can test the wire
	// format. This will panic if actually called — that's fine for now.
	log.Printf("[snapshot] InstallSnapshotRPC called (STUB) lastIdx=%d", req.Snapshot.LastIndex)
	return &InstallSnapshotResponse{Success: false, Error: "not implemented yet (john)"}, nil
}

// persistSnapshot writes the snapshot to disk. Simple JSON/gob for now; we can
// switch to a more efficient format if Amara's tests show it's a bottleneck.
func persistSnapshot(snap *Snapshot) error {
	f, err := os.Create(snapshotPath())
	if err != nil {
		return err
	}
	defer f.Close()
	return gob.NewEncoder(f).Encode(snap)
}

// loadSnapshot reads the most recent snapshot from disk on startup.
func loadSnapshot() (*Snapshot, error) {
	f, err := os.Open(snapshotPath())
	if err != nil {
		return nil, err // no snapshot yet — that's OK
	}
	defer f.Close()
	var snap Snapshot
	if err := gob.NewDecoder(f).Decode(&snap); err != nil {
		return nil, err
	}
	return &snap, nil
}

// snapshotPath returns the on-disk location for snapshots.
func snapshotPath() string {
	return "data/snapshot.gob"
}
