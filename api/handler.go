// Package handler is the Vercel Go serverless function entrypoint for the
// Memos backend. Vercel compiles this file into a function and routes
// requests to Handler; the whole Memos HTTP stack (Connect RPC, REST
// gateway, file server, MCP) runs inside it as a plain http.Handler.
//
// Required environment variables:
//
//	MEMOS_DRIVER       "postgres"
//	MEMOS_DSN          Postgres connection string (use the pooled/PgBouncer endpoint)
//	MEMOS_DATA         writable data dir, e.g. "/tmp/memos-data"
//	MEMOS_INSTANCE_URL canonical external URL, e.g. "https://memos.example.com"
package handler

import (
	"context"
	"net/http"
	"os"
	"sync"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/version"
	"github.com/usememos/memos/server"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/db"
)

var (
	initOnce sync.Once
	handler  http.Handler
	initErr  error
)

// Handler serves every request through the Memos server built once per
// function instance (cold start) and reused while the instance stays warm.
func Handler(w http.ResponseWriter, r *http.Request) {
	initOnce.Do(func() {
		handler, initErr = buildHandler()
	})
	if initErr != nil {
		http.Error(w, "memos backend unavailable", http.StatusServiceUnavailable)
		return
	}
	handler.ServeHTTP(w, r)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func buildHandler() (http.Handler, error) {
	// /tmp is the only writable directory in the serverless environment.
	dataDir := envOr("MEMOS_DATA", "/tmp/memos-data")

	p := &profile.Profile{
		Driver:         envOr("MEMOS_DRIVER", "postgres"),
		DSN:            os.Getenv("MEMOS_DSN"),
		Data:           dataDir,
		InstanceURL:    os.Getenv("MEMOS_INSTANCE_URL"),
		RateLimit:      true,
		TrustedProxies: []string{"private"},
		Version:        version.GetCurrentVersion(),
		Commit:         version.Commit,
	}
	if err := p.Validate(); err != nil {
		return nil, err
	}

	ctx := context.Background()
	dbDriver, err := db.NewDBDriver(p)
	if err != nil {
		return nil, err
	}
	storeInstance := store.New(dbDriver, p)
	// Schema migrations are idempotent (tracked schema version); they run on
	// cold start so a fresh database self-initializes.
	if err := storeInstance.Migrate(ctx); err != nil {
		return nil, err
	}
	if err := storeInstance.LoadDeploymentConfiguration(ctx); err != nil {
		return nil, err
	}
	s, err := server.NewServer(ctx, p, storeInstance)
	if err != nil {
		return nil, err
	}
	return s.Handler(), nil
}
