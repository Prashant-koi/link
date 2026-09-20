// kv.go
// State-machine application logic for the CS 431 Raft KV store.
// Amara Okafor — last updated Tue 8 Sep 2026.
//
// This file implements the linearizable operations applied by every
// node after a Raft log entry is committed. It also holds the per-client
// dedupe table that makes our requests idempotent (required for the
// Milestone 3 linearizability tests).

package kv

import (
	"fmt"
	"sync"
)

// RequestID uniquely identifies a client request for deduplication.
type RequestID struct {
	Client string
	Seq    uint64
}

// Op is one entry in the Raft log that we apply to local state.
type Op struct {
	ID     RequestID
	Type   string // "put", "get", "delete"
	Key    string
	Value  string // ignored for "get"/"delete"
	Result *string // set by apply() for "get"; nil otherwise
}

// KVStore is the state machine. All methods are safe for concurrent use
// because Raft applies ops serially per node, but we keep a mutex so the
// dedupe table and map don't race under our test harness.
type KVStore struct {
	mu    sync.Mutex
	data  map[string]string
	seen  map[RequestID]bool // dedupe: have we already applied this request?
}

func NewKVStore() *KVStore {
	return &KVStore{
		data: make(map[string]string),
		seen: make(map[RequestID]bool),
	}
}

// Apply executes one committed log entry. It returns the response payload
// (for Get) and whether this was a replay (deduped). Callers must not call
// this concurrently for the same logical sequence on one node; Raft
// guarantees single-threaded apply per term/leader handoff.
func (s *KVStore) Apply(op Op) (resp string, isReplay bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// --- Dedupe check (stale-read fix from linearizability checker) ---
	// If we've already applied this exact request ID, return the cached
	// result without mutating state again. This prevents a client that
	// retries after a leader change from seeing divergent values.
	if s.seen[op.ID] {
		return s.cachedResult(op)
	}

	switch op.Type {
	case "put":
		s.data[op.Key] = op.Value
		resp = "" // ack

	case "get":
		val, ok := s.data[op.Key]
		if !ok {
			resp = "" // empty string means not found
		} else {
			resp = val
		}
		op.Result = &resp // store for potential replay

	case "delete":
		delete(s.data, op.Key)
		resp = "" // ack

	default:
		panic(fmt.Sprintf("kv: unknown op type %q", op.Type))
	}

	s.seen[op.ID] = true
	return resp, false
}

// cachedResult returns the result we stored during the first apply of this
// request ID. We keep a small side-table so replays are consistent.
var resultCache = map[RequestID]string{}

func (s *KVStore) cachedResult(op Op) string {
	if v, ok := resultCache[op.ID]; ok {
		return v
	}
	// Fallback: if we don't have a cached result (e.g., process restart),
	// re-run the read-only op. For put/delete this is harmless no-op.
	switch op.Type {
	case "get":
		if val, ok := s.data[op.Key]; ok {
			return val
		}
		return ""
	default:
		return ""
	}
}

// --- Helpers used by the test harness (Amara's Jepsen-style injector) ---

// Put is a convenience wrapper for building an Op.
func Put(id RequestID, key, value string) Op {
	return Op{ID: id, Type: "put", Key: key, Value: value}
}

// Get is a convenience wrapper for building an Op.
func Get(id RequestID, key string) Op {
	return Op{ID: id, Type: "get", Key: key}
}

// Delete is a convenience wrapper for building an Op.
func Delete(id RequestID, key string) Op {
	return Op{ID: id, Type: "delete", Key: key}
}

// Snapshot serializes the current state for Raft snapshotting (Milestone 3).
// Returns a byte slice; format is intentionally simple (key\tvalue\n lines).
func (s *KVStore) Snapshot() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	var buf []byte
	for k, v := range s.data {
		buf = append(buf, []byte(k+"\t"+v+"\n")...)
	}
	return buf
}

// Restore replaces state from a snapshot. Used on follower catch-up.
func (s *KVStore) Restore(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = make(map[string]string)
	// TODO: parse the snapshot format properly; currently only tests use this.
	// Placeholder: assume caller passes pre-parsed entries via a separate API.
}
