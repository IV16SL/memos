// Package handler is the Vercel Go serverless function entrypoint.
//
// The body is intentionally thin: Vercel compiles this file under a
// synthetic module (import path handler/api), outside the
// github.com/usememos/memos tree, so it must not import internal/
// packages directly — Go's internal visibility rule would reject the
// build. All initialization lives in github.com/usememos/memos/serverless.
package handler

import (
	"net/http"
	"regexp"
	"sync"

	"github.com/usememos/memos/serverless"
)

// dsnRedactor masks credentials in connection strings before they ever
// reach an HTTP response body.
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
	})
	if initErr != nil {
		safe := dsnRedactor.ReplaceAllString(initErr.Error(), "://***:***@")
		http.Error(w, "memos backend init failed: "+safe, http.StatusServiceUnavailable)
		return
	}
	h.ServeHTTP(w, r)
}
