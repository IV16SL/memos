package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// resetInitState restores the package-level init state and stubs, so each
// test starts from a cold instance.
func resetInitState(t *testing.T, initFunc func() (http.Handler, error), cooldown time.Duration) {
	t.Helper()
	origFunc, origCooldown := newHTTPHandler, initRetryCooldown
	initMu.Lock()
	h, initErr, lastInitAttempt = nil, nil, time.Time{}
	initMu.Unlock()
	newHTTPHandler, initRetryCooldown = initFunc, cooldown
	t.Cleanup(func() {
		initMu.Lock()
		h, initErr, lastInitAttempt = nil, nil, time.Time{}
		initMu.Unlock()
		newHTTPHandler, initRetryCooldown = origFunc, origCooldown
	})
}

func get(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler(rec, httptest.NewRequest(http.MethodGet, "/api/memos", nil))
	return rec
}

func TestHandlerRetriesInitAfterCooldown(t *testing.T) {
	calls := 0
	okHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	initFunc := func() (http.Handler, error) {
		calls++
		if calls == 1 {
			return nil, errors.New("failed to migrate database: max clients reached")
		}
		return okHandler, nil
	}
	resetInitState(t, initFunc, 50*time.Millisecond)

	// First request fails init and gets a 503.
	if rec := get(t); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("first request: got status %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if calls != 1 {
		t.Fatalf("after first request: init called %d times, want 1", calls)
	}

	// A request inside the cooldown does not retry init.
	if rec := get(t); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("request inside cooldown: got status %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if calls != 1 {
		t.Fatalf("inside cooldown: init called %d times, want 1", calls)
	}

	// After the cooldown, the next request retries init, succeeds, and
	// the handler serves the request.
	time.Sleep(60 * time.Millisecond)
	if rec := get(t); rec.Code != http.StatusOK {
		t.Fatalf("request after cooldown: got status %d, want %d", rec.Code, http.StatusOK)
	}
	if calls != 2 {
		t.Fatalf("after cooldown: init called %d times, want 2", calls)
	}

	// Later requests reuse the initialized handler without re-init.
	if rec := get(t); rec.Code != http.StatusOK {
		t.Fatalf("follow-up request: got status %d, want %d", rec.Code, http.StatusOK)
	}
	if calls != 2 {
		t.Fatalf("follow-up request: init called %d times, want 2", calls)
	}
}

func TestHandlerReusesSuccessfulInit(t *testing.T) {
	calls := 0
	okHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	initFunc := func() (http.Handler, error) {
		calls++
		return okHandler, nil
	}
	resetInitState(t, initFunc, 50*time.Millisecond)

	for i := 0; i < 2; i++ {
		if rec := get(t); rec.Code != http.StatusOK {
			t.Fatalf("request %d: got status %d, want %d", i+1, rec.Code, http.StatusOK)
		}
	}
	if calls != 1 {
		t.Fatalf("init called %d times, want 1", calls)
	}
}
