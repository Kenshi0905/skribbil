package game

import (
	"time"

	"github.com/gofrs/uuid/v5"
)

// LeaguePlayerStats records facts accepted by the engine, never client claims.
// CorrectGuesses counts accepted solutions even if a later kick refunds the
// turn's scores; it is not a count of credited scoring events.
type LeaguePlayerStats struct {
	CorrectGuesses int
	FastestGuessMs *int64
}

func (lobby *Lobby) resetLeagueTelemetry() {
	if lobby.League == nil {
		return
	}
	ls := lobby.League
	ls.Stats = make(map[uuid.UUID]*LeaguePlayerStats)
	ls.RoundDislikes = make(map[string]int)
	ls.WordStartedAt = time.Time{}
	ls.FinalRoundNumber = 0
	ls.LastAtFinalRoundStart = nil
}

func (lobby *Lobby) recordLeagueGuess(player *Player, now time.Time) {
	if lobby.League == nil || player.AccountID == "" || player.SpectatorOnly || player.State != Guessing {
		return
	}
	ls := lobby.League
	if ls.Stats == nil {
		ls.Stats = make(map[uuid.UUID]*LeaguePlayerStats)
	}
	stats := ls.Stats[player.ID]
	if stats == nil {
		stats = &LeaguePlayerStats{}
		ls.Stats[player.ID] = stats
	}
	stats.CorrectGuesses++
	if ls.WordStartedAt.IsZero() {
		return
	}
	// Both timestamps retain Go's monotonic clock, unaffected by clock sync.
	elapsed := now.Sub(ls.WordStartedAt).Milliseconds()
	if elapsed < 0 {
		return
	}
	if ls.TurnGuessTimes != nil && ls.Eligible[player.ID] {
		if _, exists := ls.TurnGuessTimes[player.ID]; !exists {
			ls.TurnGuessTimes[player.ID] = elapsed
		}
	}
	if stats.FastestGuessMs == nil || elapsed < *stats.FastestGuessMs {
		stats.FastestGuessMs = &elapsed
	}
}

// Called once after the previous round's final artist receives their score,
// before the next round starts drawing. All-tied and single-round starts are
// not comebacks. Ties for last qualify only when another player was ahead.
func (lobby *Lobby) snapshotLeagueFinalRound() {
	if lobby.League == nil || lobby.Rounds < 2 || lobby.Round != lobby.Rounds {
		return
	}
	ls := lobby.League
	if ls.FinalRoundNumber == lobby.Round {
		return
	}
	ls.FinalRoundNumber = lobby.Round
	ls.LastAtFinalRoundStart = make(map[uuid.UUID]bool)
	count, minimum, maximum := 0, 0, 0
	for _, player := range ls.Roster {
		if player.AccountID == "" || player.SpectatorOnly {
			continue
		}
		if count == 0 || player.Score < minimum {
			minimum = player.Score
		}
		if count == 0 || player.Score > maximum {
			maximum = player.Score
		}
		count++
	}
	if count < 2 || minimum == maximum {
		return
	}
	for _, player := range ls.Roster {
		if player.AccountID != "" && !player.SpectatorOnly && player.Score == minimum {
			ls.LastAtFinalRoundStart[player.ID] = true
		}
	}
}

func (lobby *Lobby) leagueTelemetry(player *Player, rank int) (correct int, fastest any, comeback bool) {
	if stats := lobby.League.Stats[player.ID]; stats != nil {
		correct = stats.CorrectGuesses
		if stats.FastestGuessMs != nil {
			fastest = *stats.FastestGuessMs
		}
	}
	// Private hosts can change round count. Do not reuse a snapshot from a
	// previous "final" round if settings changed or the game ended early.
	comeback = rank == 1 && lobby.Round == lobby.Rounds &&
		lobby.League.FinalRoundNumber == lobby.Rounds && lobby.League.LastAtFinalRoundStart[player.ID]
	return
}
