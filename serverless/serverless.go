// Package serverless builds the complete Memos HTTP stack for serverless
// platforms such as Vercel Go functions.
//
// It exists as a non-internal package on purpose: Vercel compiles the
// function entrypoint (api/handler.go) under a synthetic module whose
// import path (handler/api) sits outside the github.com/usememos/memos
// tree, so Go's internal-package visibility rule rejects any direct
// internal/ import from the entrypoint itself. All internal/ imports live
// here, inside the module tree, where every import edge is legal; the
// thin entrypoint only imports this package.
package serverless

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/version"
	"github.com/usememos/memos/server"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/db"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// NewHTTPHandler builds the full Memos server (profile from MEMOS_*
// environment variables, database driver, schema migration, deployment
// configuration) and returns its HTTP handler. Call it once per warm
// instance and reuse the result; the returned handler is safe for
// concurrent use.
func NewHTTPHandler() (http.Handler, error) {
	dataDir := envOr("MEMOS_DATA", "/tmp/memos-data")
	// Vercel's synthetic Go build has no VCS metadata, so GetCurrentVersion()
	// returns "" and version.Commit stays "unknown". The web-clipper (and other
	// clients) reject an empty version, so fall back to the calendar version
	// of this fork. Vercel exposes the deployment's commit SHA to the function
	// at runtime via VERCEL_GIT_COMMIT_SHA, so the About page can still show
	// the build commit chip.
	ver := version.GetCurrentVersion()
	if ver == "" {
		ver = "26.10"
	}
	commit := version.Commit
	if commit == "" || commit == "unknown" {
		commit = envOr("VERCEL_GIT_COMMIT_SHA", commit)
	}
	p := &profile.Profile{
		Driver:         envOr("MEMOS_DRIVER", "postgres"),
		DSN:            os.Getenv("MEMOS_DSN"),
		Data:           dataDir,
		InstanceURL:    os.Getenv("MEMOS_INSTANCE_URL"),
		RateLimit:      true,
		TrustedProxies: []string{"private"},
		Version:        ver,
		Commit:         commit,
	}
	if err := p.Validate(); err != nil {
		return nil, fmt.Errorf("invalid profile: %w", err)
	}
	ctx := context.Background()
	dbDriver, err := db.NewDBDriver(p)
	if err != nil {
		return nil, fmt.Errorf("failed to create db driver: %w", err)
	}
	storeInstance := store.New(dbDriver, p)
	// Schema migrations are idempotent (tracked schema version); they run on
	// cold start so a fresh database self-initializes.
	if err := storeInstance.Migrate(ctx); err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}
	if err := storeInstance.LoadDeploymentConfiguration(ctx); err != nil {
		return nil, fmt.Errorf("failed to load deployment configuration: %w", err)
	}

	s, err := server.NewServer(ctx, p, storeInstance)
	if err != nil {
		return nil, fmt.Errorf("failed to create server: %w", err)
	}
	return s.Handler(), nil
}
