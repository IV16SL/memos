// Package handler is the Vercel Go serverless function entrypoint.
//
// The body is intentionally thin: Vercel compiles this file under a
// synthetic module (import path handler/api), outside the
// github.com/usememos/memos tree, so it must not import internal/
// packages directly — Go's internal visibility rule would reject the
// build. All initialization lives in github.com/usememos/memos/serverless.
package handler

import (
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/usememos/memos/serverless"
)

// dsnRedactor masks credentials in URL-style connection strings before
// an init error is written to the server log.
var dsnRedactor = regexp.MustCompile(`://[^:/@\s]+:[^/@\s]+@`)

// initRetryCooldown is how long a failed backend init waits before a
// later request tries again. Init needs a database connection, and the
// Supabase session-mode pooler has a small fixed pool shared by every
// warm function instance; when it fills up, a cold start fails init.
// The previous sync.Once cached that failure forever, so the instance
// served 503 until Vercel recycled it even after the pool drained.
// Retrying after a cooldown lets the instance heal itself with no
// redeploy.
var initRetryCooldown = 30 * time.Second

// newHTTPHandler builds the backend. It is a variable so tests can stub
// init without a database.
var newHTTPHandler = serverless.NewHTTPHandler

var (
	initMu          sync.Mutex
	h               http.Handler
	initErr         error
	lastInitAttempt time.Time
)

// Handler is invoked by the Vercel Go runtime for every request routed to
// this function. The full Memos server is built once per warm instance and
// reused for subsequent requests. If init fails (e.g. the database pool
// is exhausted), the instance keeps serving 503 but retries init on a
// later request once initRetryCooldown has passed, instead of staying
// poisoned for the rest of its lifetime.
func Handler(w http.ResponseWriter, r *http.Request) {
	initMu.Lock()
	if h == nil && (initErr == nil || time.Since(lastInitAttempt) >= initRetryCooldown) {
		lastInitAttempt = time.Now()
		h, initErr = newHTTPHandler()
		if initErr != nil {
			// Init errors come from the driver/store layer and can embed
			// the configured DSN (host, database name, credentials). Log
			// the detail server-side only, with credentials masked;
			// clients get a generic 503 so nothing about the deployment
			// leaks in the response body.
			slog.Error("memos backend init failed", "error", redactInitError(initErr))
		}
	}
	handler, err := h, initErr
	initMu.Unlock()

	if err != nil {
		http.Error(w, "memos backend unavailable", http.StatusServiceUnavailable)
		return
	}
	handler.ServeHTTP(w, r)
}

// passwordParamRedactor masks password=... pairs in key-value or
// query-param style connection strings, which dsnRedactor's URL pattern
// does not cover.
var passwordParamRedactor = regexp.MustCompile(`(?i)(password=)[^ &]+`)

// redactInitError masks credentials that a driver or store error may
// embed from the configured DSN.
func redactInitError(err error) string {
	s := dsnRedactor.ReplaceAllString(err.Error(), "://***:***@")
	return passwordParamRedactor.ReplaceAllString(s, "${1}***")
}
