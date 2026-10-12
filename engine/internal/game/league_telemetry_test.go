package game

import (
	"testing"
	"time"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

func telemetryFixture() (*Lobby, *Player, *Player, *Player, *Player) {
	l, artist, a, b, spec := penaltyFixture()
	a.AccountID = "guesser-a"
	b.AccountID = "guesser-b"
	spec.AccountID = "spectator"
	l.League.Roster = []*Player{artist, a, b, spec}
	l.lowercaser = cases.Lower(language.English)
	l.DrawingTime = 60
	l.Round = 1
	l.Rounds = 3
	l.roundEndTime = time.Now().Add(time.Minute).UnixMilli()
	l.ScoreCalculation = CompetitiveScoring
	for _, p := range l.players {
		p.messageTimestamps = NewRing[time.Time](5)
	}
	return l, artist, a, b, spec
}

func TestTelemetryCountsOnlyAcceptedCorrectGuesses(t *testing.T) {
	l, artist, a, b, spec := telemetryFixture()
	l.League.WordStartedAt = time.Now().Add(-2 * time.Second)
	handleMessage("dog", a, l)
	if stats := l.League.Stats[a.ID]; stats != nil {
		t.Fatal("incorrect guess created success telemetry")
	}
	handleMessage("cat", a, l)
	stats := l.League.Stats[a.ID]
	if stats == nil || stats.CorrectGuesses != 1 || stats.FastestGuessMs == nil || *stats.FastestGuessMs < 2000 || *stats.FastestGuessMs >= 5000 {
		t.Fatal("correct guess missing real server elapsed time")
	}
	handleMessage("cat", a, l)      // Already solved: cannot count again.
	handleMessage("cat", artist, l) // Artist chat: cannot guess their own prompt.
	handleMessage("cat", spec, l)   // Native spectator chat must not award guesses.
	if stats.CorrectGuesses != 1 || l.League.Stats[artist.ID] != nil || l.League.Stats[spec.ID] != nil {
		t.Fatal("duplicate, artist, or spectator counted as a guess")
	}
	if correct, fastest, _ := l.leagueTelemetry(b, 2); correct != 0 || fastest != nil {
		t.Fatal("player without guesses received fabricated timing")
	}
}

func TestFastestGuessUsesWordStartAndKeepsActualMinimum(t *testing.T) {
	l, _, a, _, _ := telemetryFixture()
	started := time.Now()
	l.League.WordStartedAt = started
	l.recordLeagueGuess(a, started.Add(5*time.Second))
	l.recordLeagueGuess(a, started.Add(7*time.Second))
	l.recordLeagueGuess(a, started.Add(2500*time.Millisecond))
	stats := l.League.Stats[a.ID]
	if stats.CorrectGuesses != 3 || *stats.FastestGuessMs != 2500 {
		t.Fatal("fastest accepted guess minimum incorrect")
	}
	// Missing timing must remain unknown, not become zero/mind-reader eligible.
	l.resetLeagueTelemetry()
	l.recordLeagueGuess(a, started)
	if l.League.Stats[a.ID].FastestGuessMs != nil {
		t.Fatal("missing word start produced a fake timing")
	}
	l.beginDislikes()
	if l.League.WordStartedAt.IsZero() || time.Since(l.League.WordStartedAt) > time.Second {
		t.Fatal("word-start timestamp was not initialized at word selection")
	}
}

func TestFinalRoundSnapshotIsFrozenAndComebackRequiresWinning(t *testing.T) {
	l, artist, a, b, spec := telemetryFixture()
	artist.Score = 100
	a.Score = -20
	b.Score = -20
	spec.Score = -1000
	l.snapshotLeagueFinalRound()
	if len(l.League.LastAtFinalRoundStart) != 0 {
		t.Fatal("snapshot taken before final round")
	}
	l.Round = 3
	l.snapshotLeagueFinalRound()
	if !l.League.LastAtFinalRoundStart[a.ID] || !l.League.LastAtFinalRoundStart[b.ID] || l.League.LastAtFinalRoundStart[artist.ID] || l.League.LastAtFinalRoundStart[spec.ID] {
		t.Fatal("last-place snapshot included leader/spectator or missed bottom tie")
	}
	a.Score = 200
	b.Score = 0
	l.snapshotLeagueFinalRound()
	if !l.League.LastAtFinalRoundStart[a.ID] {
		t.Fatal("snapshot changed after final round started")
	}
	if _, _, comeback := l.leagueTelemetry(a, 1); !comeback {
		t.Fatal("last-place winner not recognized")
	}
	if _, _, comeback := l.leagueTelemetry(b, 3); comeback {
		t.Fatal("nonwinner received comeback")
	}
	if _, _, comeback := l.leagueTelemetry(artist, 1); comeback {
		t.Fatal("previous leader received comeback")
	}
	l.Rounds = 4
	if _, _, comeback := l.leagueTelemetry(a, 1); comeback {
		t.Fatal("stale final-round snapshot reused after changing rules")
	}
}

func TestNoComebackFromAllTiedOrSingleRoundMatch(t *testing.T) {
	l, artist, a, b, _ := telemetryFixture()
	artist.Score = 0
	a.Score = 0
	b.Score = 0
	l.Round = 3
	l.snapshotLeagueFinalRound()
	if len(l.League.LastAtFinalRoundStart) != 0 {
		t.Fatal("all-tied start manufactured a comeback")
	}
	l.resetLeagueTelemetry()
	l.Round = 1
	l.Rounds = 1
	a.Score = -100
	l.snapshotLeagueFinalRound()
	if len(l.League.LastAtFinalRoundStart) != 0 {
		t.Fatal("single-round match manufactured a comeback")
	}
}

func TestFinalRoundTransitionSettlesPreviousArtistBeforeSnapshot(t *testing.T) {
	l, artist, a, b, _ := telemetryFixture()
	l.Round = 2
	l.Rounds = 3
	l.WordsPerTurn = 3
	l.words = []string{"cat", "dog", "tree"}
	artist.Score = 0
	a.Score = 50
	b.Score = 100
	a.State = Standby
	b.State = Standby
	a.LastScore = 150
	b.LastScore = 150
	defer l.Shutdown()
	l.Synchronized(func() {
		advanceLobbyPredefineDrawer(l, true, a)
		if l.Round != 3 || artist.Score != 150 {
			t.Fatal("native previous artist score did not settle")
		}
		if l.League.LastAtFinalRoundStart[artist.ID] || !l.League.LastAtFinalRoundStart[a.ID] {
			t.Fatal("snapshot happened before previous artist score settled")
		}
	})
}

func TestMatchCompletionEmitsDetachedPlayerTelemetry(t *testing.T) {
	l, artist, a, b, _ := telemetryFixture()
	artist.Score = 100
	a.Score = 0
	b.Score = 10
	l.Round = 3
	l.snapshotLeagueFinalRound()
	l.League.WordStartedAt = time.Now()
	l.recordLeagueGuess(a, l.League.WordStartedAt.Add(4*time.Second))
	a.Score = 200
	var event LeagueEvent
	l.League.Emit = func(e LeagueEvent) bool { event = e; return true }
	l.completeLeagueMatch()
	first := event.Payload.(map[string]any)["participants"].([]map[string]any)[0]
	if first["userId"] != a.AccountID || first["correctGuesses"] != 1 || first["fastestGuessMs"] != int64(4000) || first["comebackWin"] != true {
		t.Fatal("final participant telemetry missing or incorrect")
	}
	*l.League.Stats[a.ID].FastestGuessMs = 1
	if first["fastestGuessMs"] != int64(4000) {
		t.Fatal("queued event shares mutable telemetry")
	}
}
