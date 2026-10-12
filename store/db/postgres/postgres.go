package postgres

import (
	"context"
	"database/sql"
	"log"
	"time"

	// Import the PostgreSQL driver.
	_ "github.com/lib/pq"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/store"
)

type DB struct {
	db      *sql.DB
	profile *profile.Profile
}

func NewDB(profile *profile.Profile) (store.Driver, error) {
	if profile == nil {
		return nil, errors.New("profile is nil")
	}

	// Open the PostgreSQL connection
	db, err := sql.Open("postgres", profile.DSN)
	if err != nil {
		log.Printf("Failed to open database: %s", err)
		return nil, errors.Wrapf(err, "failed to open database: %s", profile.DSN)
	}
	// Serverless-friendly pool: each function instance caps its own
	// connections; use the pooled (PgBouncer) DSN endpoint in MEMOS_DSN.
	// Keep low for Supabase session-mode pooler (free tier pool_size=15
	// shared across all function instances).
	db.SetMaxOpenConns(3)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(time.Minute)
	// Supavisor (Supabase pooler) closes idle server connections; recycle
	// ours first so the pool never hands out a dead connection after the
	// page sits idle (e.g. past the 15-min access token lifetime).
	db.SetConnMaxIdleTime(30 * time.Second)

	var driver store.Driver = &DB{
		db:      db,
		profile: profile,
	}

	// Return the DB struct
	return driver, nil
}

func (d *DB) GetDB() *sql.DB {
	return d.db
}

func (d *DB) Close() error {
	return d.db.Close()
}

func (d *DB) IsInitialized(ctx context.Context) (bool, error) {
	var exists bool
	err := d.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_catalog = current_database() AND table_name = 'memo' AND table_type = 'BASE TABLE')").Scan(&exists)
	if err != nil {
		return false, errors.Wrap(err, "failed to check if database is initialized")
	}
	return exists, nil
}

// GetDatabaseSize returns the database size in bytes, or -1 if unavailable.
func (d *DB) GetDatabaseSize(ctx context.Context) (int64, error) {
	var size int64
	const q = `SELECT pg_database_size(current_database())`
	if err := d.db.QueryRowContext(ctx, q).Scan(&size); err != nil {
		return -1, errors.Wrap(err, "failed to query postgres database size")
	}
	return size, nil
}
