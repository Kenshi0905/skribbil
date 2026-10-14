package game

import (
	"encoding/json"
	"sync"
	"testing"

	"github.com/gofrs/uuid/v5"
)

func penaltyFixture() (*Lobby, *Player, *Player, *Player, *Player) {
	artist := &Player{ID: uuid.Must(uuid.NewV4()), AccountID: "artist", State: Drawing, Connected: true, Score: 40}
	a := &Player{ID: uuid.Must(uuid.NewV4()), State: Guessing, Connected: true}
	b := &Player{ID: uuid.Must(uuid.NewV4()), State: Guessing, Connected: true}
	spec := &Player{ID: uuid.Must(uuid.NewV4()), State: Spectating, Connected: true, SpectatorOnly: true}
	l := &Lobby{players: []*Player{artist, a, b, spec}, State: Ongoing, CurrentWord: "cat", WriteObject: noOpWriteObject, WritePreparedMessage: noOpWritePreparedMessage, League: &LeagueState{MatchID: "match", Mode: "private"}}
	l.beginDislikes()
	return l, artist, a, b, spec
}

func vote(l *Lobby, p *Player, turn int) error {
	b, _ := json.Marshal(map[string]any{"type": EventTypeDislike, "data": map[string]int{"turnId": turn}})
	return l.HandleEvent(EventTypeDislike, b, p)
}

func TestDislikesRequireEveryEligibleGuesserOnce(t *testing.T) {
	l, artist, a, b, spec := penaltyFixture()
	if len(l.League.Eligible) != 2 {
		t.Fatal("artist and spectator must not enter denominator")
	}
	if vote(l, artist, 1) == nil || vote(l, spec, 1) == nil {
		t.Fatal("ineligible players could vote")
	}
	if vote(l, a, 0) == nil {
		t.Fatal("stale vote accepted")
	}
	if err := vote(l, a, 1); err != nil {
		t.Fatal(err)
	}
	if artist.Score != 40 {
		t.Fatal("penalty fired without unanimity")
	}
	if err := vote(l, a, 1); err != nil {
		t.Fatal(err)
	}
	if len(l.League.Votes) != 1 {
		t.Fatal("duplicate vote counted")
	}
	if err := vote(l, b, 1); err != nil {
		t.Fatal(err)
	}
	if artist.Score != -60 || !artist.HardWordPending {
		t.Fatal("exact negative deduction/hard word missing")
	}
	_ = vote(l, b, 1)
	if artist.Score != -60 {
		t.Fatal("penalty applied twice")
	}
}

func TestDislikeConcurrentDuplicatesApplyOnlyOnce(t *testing.T) {
	l, artist, a, b, _ := penaltyFixture()
	var wg sync.WaitGroup
	for i := 0; i < 80; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			p := a
			if i%2 == 0 {
				p = b
			}
			_ = vote(l, p, 1)
		}(i)
	}
	wg.Wait()
	if artist.Score != -60 || len(l.League.Votes) != 2 {
		t.Fatal("concurrent votes violated once-only penalty")
	}
}

func TestDislikeDisconnectDoesNotLowerQuorumAndNewcomerCannotVote(t *testing.T) {
	l, artist, a, b, _ := penaltyFixture()
	b.Connected = false
	_ = vote(l, a, 1)
	if artist.Score != 40 || len(l.League.Eligible) != 2 {
		t.Fatal("disconnect manufactured unanimity")
	}
	newcomer := &Player{ID: uuid.Must(uuid.NewV4()), State: Guessing, Connected: true}
	l.players = append(l.players, newcomer)
	if vote(l, newcomer, 1) == nil {
		t.Fatal("newcomer entered frozen electorate")
	}
	b.Connected = true
	if vote(l, b, 1) != nil || artist.Score != -60 {
		t.Fatal("reconnect did not preserve voting identity")
	}
}

func TestHardWordPendingIsConsumedOnlyWhenWordBegins(t *testing.T) {
	l, artist, _, _, _ := penaltyFixture()
	artist.HardWordPending = true
	l.wordChoice = []string{"cat", "dog", "tree"}
	l.leagueWordChoice(artist)
	if len(l.wordChoice) != 1 || !artist.HardWordPending {
		t.Fatal("hard choice must be forced without early consumption")
	}
	found := false
	for _, w := range hardWordsV1 {
		if l.wordChoice[0] == w {
			found = true
		}
	}
	if !found {
		t.Fatal("forced word not from curated hard pack")
	}
	l.beginDislikes()
	if artist.HardWordPending {
		t.Fatal("pending flag not consumed on word start")
	}
	l.wordChoice = []string{"cat", "dog", "tree"}
	l.leagueWordChoice(artist)
	if len(l.wordChoice) != 3 {
		t.Fatal("hard choice leaked into subsequent unpenalized turn")
	}
}

func TestTurnArchiveSurvivesCanvasMutation(t *testing.T) {
	l, _, _, _, _ := penaltyFixture()
	var event LeagueEvent
	l.League.Emit = func(e LeagueEvent) bool { event = e; return true }
	line := &LineEvent{Type: EventTypeLine}
	l.AppendLine(line)
	l.archiveLeagueTurn()
	l.currentDrawing[0] = nil
	l.ClearDrawing()
	payload := event.Payload.(map[string]any)
	if payload["drawing"].([]any)[0] != line {
		t.Fatal("archive shares mutable canvas slice")
	}
}

func TestSoloRoomNeverPenalizes(t *testing.T) {
	l, artist, _, _, _ := penaltyFixture()
	l.players = []*Player{artist}
	l.beginDislikes()
	if l.League.Applied || artist.Score != 40 {
		t.Fatal("zero eligible voters caused penalty")
	}
}

func TestLeagueSpectatorsDoNotTakeSlotsBlockReadinessOrAlterKickQuorum(t *testing.T) {
	l, artist, a, b, spec := penaltyFixture()
	l.MaxPlayers = 4
	l.players = append(l.players, &Player{State: Spectating, SpectatorOnly: true, Connected: true})
	if !l.HasFreePlayerSlot() || l.GetOccupiedPlayerSlots() != 3 {
		t.Fatal("spectators consumed participant slots")
	}
	artist.State = Ready
	a.State = Ready
	b.State = Ready
	if !l.readyToStart() {
		t.Fatal("spectators blocked player readiness")
	}
	if calculateVotesNeededToKick(l) != 2 {
		t.Fatal("spectators changed kick quorum")
	}
	if err := l.HandleEvent(EventTypeMessage, []byte(`{"data":"spoiler"}`), spec); err == nil {
		t.Fatal("spectator could post into participant chat")
	}
}

func TestMatchResultRetainsRemovedParticipants(t *testing.T) {
	l, artist, a, _, spec := penaltyFixture()
	a.AccountID = "a"
	a.Score = 100
	l.League.Roster = []*Player{artist, a, spec}
	l.players = []*Player{a, spec}
	var event LeagueEvent
	l.League.Emit = func(e LeagueEvent) bool { event = e; return true }
	l.completeLeagueMatch()
	participants := event.Payload.(map[string]any)["participants"].([]map[string]any)
	if len(participants) != 2 || participants[1]["userId"] != "artist" || participants[0]["rank"] != 1 {
		t.Fatal("removed artist lost from authoritative result")
	}
}

func TestCompletedMatchSnapshotsConfiguredPrivateRules(t *testing.T) {
	l, _, _, _, _ := penaltyFixture()
	l.Rounds = 5
	l.MaxPlayers = 6
	l.DrawingTime = 80
	var event LeagueEvent
	l.League.Emit = func(e LeagueEvent) bool { event = e; return true }
	l.completeLeagueMatch()
	settings := event.Payload.(map[string]any)["settings"].(map[string]int)
	if settings["rounds"] != 5 || settings["drawTime"] != 80 || settings["maxPlayers"] != 6 {
		t.Fatal("completed match did not capture native private settings")
	}
	// A setting changed during the final drawing takes effect next turn in
	// the native game. It should take effect in a subsequent rematch as well.
	l.DrawingTimeNew = 120
	l.completeLeagueMatch()
	settings = event.Payload.(map[string]any)["settings"].(map[string]int)
	l.DrawingTimeNew = 160
	l.Rounds = 9
	if settings["drawTime"] != 120 || settings["rounds"] != 5 {
		t.Fatal("emitted rules snapshot was stale or shared mutable state")
	}
}

func TestCancellationCannotRacePastStartedGame(t *testing.T) {
	l, _, _, _, _ := penaltyFixture()
	if err := l.CancelLeagueBeforeStart("match"); err == nil {
		t.Fatal("running match cancellation accepted")
	}
	if l.State != Ongoing {
		t.Fatal("rejected cancellation mutated game")
	}
	l.State = Unstarted
	if err := l.CancelLeagueBeforeStart("another-match"); err == nil {
		t.Fatal("cross-match cancellation accepted")
	}
	if err := l.CancelLeagueBeforeStart("match"); err != nil {
		t.Fatal(err)
	}
	if l.State != GameOver || !l.League.Cancelled {
		t.Fatal("unstarted cancellation not applied")
	}
	if err := l.CancelLeagueBeforeStart("match"); err != nil {
		t.Fatal("cancellation retry not idempotent")
	}
}

func TestLikesAreEligiblePerTurnReactionsWithoutScoreChanges(t *testing.T) {
	l, artist, a, b, spec := penaltyFixture()
	like := func(p *Player, turn int) error {
		payload, _ := json.Marshal(map[string]any{"type": EventTypeLike, "data": map[string]int{"turnId": turn}})
		return l.HandleEvent(EventTypeLike, payload, p)
	}
	for _, p := range []*Player{artist, spec, {ID: uuid.Must(uuid.NewV4()), State: Guessing, Connected: true}} {
		if like(p, 1) == nil {
			t.Fatal("ineligible like accepted")
		}
	}
	if like(a, 0) == nil {
		t.Fatal("stale like accepted")
	}
	if err := like(a, 1); err != nil {
		t.Fatal(err)
	}
	if err := like(a, 1); err != nil {
		t.Fatal(err)
	}
	if err := like(b, 1); err != nil {
		t.Fatal(err)
	}
	state := l.dislikeState()
	if state.Likes != 2 || len(state.Likers) != 2 || state.Votes != 0 || artist.Score != 40 || artist.HardWordPending {
		t.Fatal("likes changed score or counted twice", state)
	}
	if err := vote(l, a, 1); err != nil {
		t.Fatal(err)
	}
	if err := like(a, 1); err != nil {
		t.Fatal(err)
	}
	if len(l.League.Likes) != 1 || l.League.Likes[a.ID] {
		t.Fatal("a dislike must replace the like and remain final")
	}
	if err := vote(l, b, 1); err != nil {
		t.Fatal(err)
	}
	if artist.Score != -60 || !artist.HardWordPending || len(l.League.Likes) != 0 {
		t.Fatal("likes altered the existing unanimous penalty")
	}
	l.beginDislikes()
	if l.dislikeState().Likes != 0 || l.dislikeState().Votes != 0 {
		t.Fatal("reactions carried into next turn")
	}
	l.CurrentWord = ""
	if l.dislikeState().Active {
		t.Fatal("voting active while choosing a word")
	}
	if like(a, 2) == nil {
		t.Fatal("like accepted while choosing a word")
	}
}
