package service

import (
	"context"
	"log/slog"
	"path/filepath"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/live"
	"github.com/hayfordstanley/altar-os/internal/domain/plan"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/media"
)

// The recording retention sweeper.
//
// Act 843 s.24 does not permit holding personal data longer than the purpose
// requires, and a recorded service is personal data of everybody in the room —
// sensitive personal data under s.1, because it reveals religious belief. A
// retention policy that lives in a settings page and is enforced by nobody is
// not a policy; this is what makes it true.
//
// Runs alongside the other sweepers, on the same pattern: a ticker, a bounded
// batch, and errors that log rather than stop the loop.

const (
	// recordingSweepInterval is how often expiry is checked.
	//
	// Hourly rather than daily. A church that shortens its retention to thirty
	// days expects that to mean something within the day, and an hourly sweep
	// costs one indexed query against a small collection.
	recordingSweepInterval = time.Hour

	// recordingSweepBatch bounds one pass.
	//
	// Deleting files is disk work, and an unbounded first run after a backlog
	// would compete with a live service for the same disk. The next tick
	// takes the rest.
	recordingSweepBatch = 100
)

// startRecordingRetention runs the sweeper until the context ends.
func startRecordingRetention(ctx context.Context, d *deps.Deps) {
	dir := recordingDir(d)
	if dir == "" {
		// Nothing was ever written, so there is nothing to erase. Said out
		// loud rather than returning silently, because "retention is running"
		// is exactly the thing nobody should have to assume.
		slog.Info("recording retention not started: recording is not configured")
		return
	}

	svc := live.NewService(d.Mongo, plan.NewService(d.Mongo), mediaServerFor(d))
	slog.Info("recording retention sweeper started",
		"interval", recordingSweepInterval,
		"default_retention", live.DefaultRetention,
		"max_retention", live.MaxRetention)

	ticker := time.NewTicker(recordingSweepInterval)
	defer ticker.Stop()

	// Once at startup, then on the tick. A process that restarts every few
	// hours would otherwise never reach its first sweep.
	sweepRecordings(ctx, svc, dir)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepRecordings(ctx, svc, dir)
		}
	}
}

// sweepRecordings erases recordings past their retention.
func sweepRecordings(ctx context.Context, svc *live.Service, dir string) {
	expired, err := svc.ExpiredRecordings(ctx, time.Now().UTC(), recordingSweepBatch)
	if err != nil {
		slog.Error("could not find expired recordings", "error", err)
		return
	}
	if len(expired) == 0 {
		return
	}

	var erased int
	for i := range expired {
		rec := &expired[i]

		// The FILES first, then the row. If the process dies between the two,
		// the recording is found again next hour and the delete is retried —
		// which is harmless. The other order would mark a recording erased
		// while its video was still on disk, and nothing would ever look at
		// it again.
		base := filepath.Base(rec.StoragePath)
		if base != "" && base != "." && base != string(filepath.Separator) {
			if err := media.RemoveRecording(dir, base); err != nil {
				slog.Error("could not erase a recording past its retention",
					"recording", rec.ID.Hex(), "church", rec.ChurchID.String(),
					"error", err)
				continue
			}
		}
		if err := svc.MarkRecordingDeleted(ctx, rec.ID.Hex()); err != nil {
			slog.Error("erased a recording but could not record that",
				"recording", rec.ID.Hex(), "error", err)
			continue
		}
		erased++
	}

	if erased > 0 {
		// Logged at INFO because this is an erasure of somebody's personal
		// data happening automatically, and it should be visible in the
		// record that it happened rather than inferrable from an absence.
		slog.Info("erased recordings past their retention",
			"count", erased, "found", len(expired))
	}
}

// recordingDir is where recordings are written, or empty when recording is off.
func recordingDir(d *deps.Deps) string {
	if d.Config == nil {
		return ""
	}
	return d.Config.Live.RecordingDir
}
