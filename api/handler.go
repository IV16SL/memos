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

	"github.com/usememos/memos/serverless"
)

// dsnRedactor masks credentials in URL-style connection strings before
// an init error is written to the server log.
var dsnRedactor = regexp.MustCompile(`://[^:/@\s]+:[^/@\s]+@`)

var (
	initOnce sync.Once
	h        http.Handler
	initErr  error
)

// Handler is invoked by the Vercel Go runtime for every request routed to
// this function. The full Memos server is built once per warm instance and
// reused for subsequent requests.
func Handler(w http.ResponseWriter, r *http.Request) {
	initOnce.Do(func() {
		h, initErr = serverless.NewHTTPHandler()
		if initErr != nil {
			// Init errors come from the driver/store layer and can embed
			// the configured DSN (host, database name, credentials). Log
			// the detail server-side only, with credentials masked;
			// clients get a generic 503 so nothing about the deployment
			// leaks in the response body.
			slog.Error("memos backend init failed", "error", redactInitError(initErr))
		}
	})
	if initErr != nil {
		http.Error(w, "memos backend unavailable", http.StatusServiceUnavailable)
		return
	}
	h.ServeHTTP(w, r)
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
