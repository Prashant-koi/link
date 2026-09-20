// Package raft implements a minimal Raft consensus node for CS 431.
// Author: John Doe
// Last updated: Mon 14 Sep 2026
//
// NOTE: This is the core state machine and RPC handler logic.
// Leader election is handled in `election.go` (Nina's territory).
// Testing/fault injection is in `tests/` (Amara's territory).

package raft

import (
	"fmt"
	"sync"
)

// State represents the persistent and volatile state of a Raft node.
// We use a single struct for simplicity in the course project,
// but in production these would likely be separated.
type State struct {
	mu sync.Mutex

	// Persistent state (must survive crashes)
	PeerID        string
	VotedFor      string   // ID of candidate we voted for in current term
	Term          int      // Current term
	Log           []LogEntry // Committed and uncommitted entries
	CommitIndex   int      // Index of highest log entry applied to state machine

	// Volatile state (reset on restart)
	NextIndex map[string]int // Index of next log entry to send to each peer
	MatchIndex map[string]int // Highest log index known to be replicated to peer

	// lastApplied tracks the highest index actually processed by the SM.
	// CRITICAL: We must check this before applying to avoid double-applying
	// if a leader replicates an entry we've already executed (e.g., after
	// a partition heal where we thought we were behind but weren't).
	lastApplied int
}

// LogEntry is a single command in the log.
type LogEntry struct {
	Term    int
	Command string // Serialized KV operation: "SET key value" or "DEL key"
}

// NewState initializes a new Raft node state.
func NewState(peerID string) *State {
	return &State{
		PeerID:     peerID,
		Term:       0,
		Log:        make([]LogEntry, 0),
		NextIndex:  make(map[string]int),
		MatchIndex: make(map[string]int),
		lastApplied: 0,
	}
}

// Apply executes a log entry on the state machine.
// Returns true if a new entry was applied, false if it was already applied.
func (s *State) Apply(index int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	// BUGFIX (John, Sep 14): Check lastApplied to prevent double-application.
	// If the leader sends us an entry we've already executed (e.g., due to
	// clock skew or partition healing), we must NOT apply it again.
	if index <= s.lastApplied {
		return false
	}

	// TODO: Actually parse and execute the Command (SET/DEL) here.
	// For now, just track the index.
	s.lastApplied = index
	return true
}

// HandleAppendEntries processes an AppendEntries RPC from a leader.
// Returns the response to send back to the leader.
func (s *State) HandleAppendEntries(req AppendEntriesRequest) AppendEntriesResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 1. Term check: If our term is higher, reject immediately.
	if req.Term < s.Term {
		return AppendEntriesResponse{
			Term:    s.Term,
			Success: false,
		}
	}

	// 2. Update our term if the leader's is higher (we are now a follower).
	if req.Term > s.Term {
		s.Term = req.Term
		s.VotedFor = "" // Reset vote for new term
	}

	// 3. Consistency check: Verify the log matches up to prevLogIndex.
	//    If our log is shorter than prevLogIndex, or the terms don't match,
	//    we are out of sync.
	if req.PrevLogIndex >= len(s.Log) {
		return AppendEntriesResponse{
			Term:    s.Term,
			Success: false,
		}
	}

	if req.PrevLogIndex > 0 && s.Log[req.PrevLogIndex-1].Term != req.PrevLogTerm {
		return AppendEntriesResponse{
			Term:    s.Term,
			Success: false,
		}
	}

	// 4. Conflict resolution: Truncate any conflicting suffix of our log.
	//    If the new entries conflict with existing ones, delete the old ones.
	//    This is the "last log wins" rule from the Raft paper.
	newEntries := req.Entries
	if len(newEntries) > 0 {
		conflictIndex := req.PrevLogIndex + 1
		for i, entry := range newEntries {
			idx := conflictIndex + i
			if idx < len(s.Log) && s.Log[idx].Term != entry.Term {
				// Conflict detected. Truncate from this index onwards.
				s.Log = s.Log[:idx]
				break
			}
		}
		// Append new entries
		s.Log = append(s.Log, newEntries...)
	}

	// 5. Update commit index if leader's is ahead.
	if req.LeaderCommit > s.CommitIndex {
		// We can only advance up to the last replicated entry.
		maxCommit := len(s.Log) - 1
		if req.LeaderCommit < maxCommit {
			maxCommit = req.LeaderCommit
		}
		if maxCommit > s.CommitIndex {
			s.CommitIndex = maxCommit
		}
	}

	// Note: We do NOT apply entries here directly.
	// The main loop in `node.go` will check CommitIndex and call Apply()
	// for any new indices between lastApplied+1 and CommitIndex.
	// This separation ensures we don't block the RPC handler on SM work.

	return AppendEntriesResponse{
		Term:    s.Term,
		Success: true,
	}
}

// --- RPC Request/Response Types (simplified for this excerpt) ---

type AppendEntriesRequest struct {
	Term           int
	LeaderID       string
	PrevLogIndex   int
	PrevLogTerm    int
	Entries        []LogEntry
	LeaderCommit   int
}

type AppendEntriesResponse struct {
	Term    int
	Success bool
}
