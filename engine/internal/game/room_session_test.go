package game

import (
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/lxzan/gws"
)

func TestResultsSessionRequiresCurrentConnectedLeader(t *testing.T) {
	l, host, guest, spectator := roomFixture(t, true)
	l.State = GameOver
	for _, account := range []string{guest.AccountID, spectator.AccountID, "unknown"} {
		if _, err := l.ResultsSessionMembers("room", account); err == nil {
			t.Fatal("non-leader obtained session authority")
		}
		if err := l.CloseResultsSession("room", account); err == nil {
			t.Fatal("non-leader closed the room")
		}
	}
	if members, err := l.ResultsSessionMembers("room", host.AccountID); err != nil || len(members) != 3 || members[2].Role != "spectator" {
		t.Fatalf("connected roster unavailable: %v %v", members, err)
	}
	l.State = Ongoing
	if err := l.CloseResultsSession("room", host.AccountID); err == nil {
		t.Fatal("running game could be deleted")
	}
	l.State = GameOver
	host.Connected = false
	if err := l.CloseResultsSession("room", host.AccountID); err == nil {
		t.Fatal("disconnected leader retained authority")
	}
	l.OwnerID = guest.ID
	var closed bool
	l.WritePreparedMessage = func(_ *Player, _ *gws.Broadcaster) error {
		closed = true
		return nil
	}
	if err := l.CloseResultsSession("room", guest.AccountID); err != nil || !closed || !l.League.Cancelled {
		t.Fatal("current leader could not close the results room", err)
	}
}

func TestTransferredSessionPreservesIdentityAndStartsWithNewScores(t *testing.T) {
	source, host, guest, spec := roomFixture(t, true)
	source.State = GameOver
	host.Score, guest.Score = 500, 200
	host.Name, guest.Name = "Room host", "Room guest"
	target, targetHost, targetGuest, targetSpec := roomFixture(t, true)
	target.League.MatchID = "next"
	for _, p := range target.players {
		p.Connected = false
	}
	admitted := map[string]string{host.AccountID: "player", guest.AccountID: "player", spec.AccountID: "spectator"}
	var transfers int
	source.WriteObject = func(_ *Player, event any) error {
		if e, ok := event.(Event); ok && e.Type == "room-session-transition" {
			transfers++
		}
		return nil
	}
	if err := source.TransferResultsSession("room", guest.AccountID, target, "next", admitted); err == nil {
		t.Fatal("guest initiated transfer")
	}
	delete(admitted, spec.AccountID)
	if err := source.TransferResultsSession("room", host.AccountID, target, "next", admitted); err == nil {
		t.Fatal("a connected spectator was left behind by an outdated roster")
	}
	admitted[spec.AccountID] = "spectator"
	if err := source.TransferResultsSession("room", host.AccountID, target, "next", admitted); err != nil {
		t.Fatal(err)
	}
	if transfers != 3 || source.State != GameOver || host.Score != 500 || source.League.MatchID != "room" {
		t.Fatal("transfer failed to preserve completed results or notify everyone")
	}
	if err := source.CloseResultsSession("room", host.AccountID); err == nil {
		t.Fatal("a transferred room was deleted during the next session")
	}
	if target.OwnerID != uuid.Nil {
		t.Fatal("successor still has placeholder ownership")
	}
	targetGuest.Score = 999
	target.Synchronized(func() { target.OnPlayerConnectUnsynchronized(targetGuest) })
	if target.State != Unstarted || targetGuest.State != Ready || targetGuest.Name != "Room guest" {
		t.Fatal("guest was not readied with its previous room identity")
	}
	if err := target.HandleEvent(EventTypeStart, []byte(`{"type":"start"}`), targetGuest); err == nil {
		t.Fatal("guest started the next session before its leader arrived")
	}
	target.Synchronized(func() { target.OnPlayerConnectUnsynchronized(targetHost) })
	if target.State != Ongoing || target.OwnerID != targetHost.ID || targetHost.Name != "Room host" {
		t.Fatal("session did not automatically start with the same leader")
	}
	if targetHost.Score != 0 || targetGuest.Score != 0 || target.League.MatchID != "next" {
		t.Fatal("next session retained old scores or result identity")
	}
	if targetSpec.State != Spectating {
		t.Fatal("spectator became a player")
	}
	transfers = 0
	var readyBeforeTransfer bool
	source.WriteObject = func(_ *Player, event any) error {
		if e, ok := event.(Event); ok {
			if e.Type == EventTypeReady {
				readyBeforeTransfer = true
			}
			if e.Type == "room-session-transition" {
				if !readyBeforeTransfer {
					t.Fatal("reconnected player cannot see results if transfer fails")
				}
				transfers++
			}
		}
		return nil
	}
	source.Synchronized(func() { source.OnPlayerConnectUnsynchronized(guest) })
	if transfers != 1 {
		t.Fatal("a reconnected results player was not offered the next session")
	}
}

func TestLeaderLeavingResultsPassesControlsToRemainingPlayer(t *testing.T) {
	l, host, guest, _ := roomFixture(t, true)
	l.State = GameOver
	host.ws = &gws.Conn{}
	l.OnPlayerDisconnect(host)
	if l.OwnerID != guest.ID {
		t.Fatal("remaining players were left without a room leader")
	}
	if _, err := l.ResultsSessionMembers("room", guest.AccountID); err != nil {
		t.Fatal(err)
	}
}

func TestDeletingResultsAlsoClosesAnEmptyFailedReplay(t *testing.T) {
	source, host, _, _ := roomFixture(t, true)
	source.State = GameOver
	pending, _, _, _ := roomFixture(t, true)
	pending.League.MatchID = "pending-match"
	for _, p := range pending.players {
		p.Connected = false
	}
	closed, err := source.CloseResultsAndPendingSession("room", host.AccountID, pending, "pending-match")
	if err != nil || !closed || !pending.League.Cancelled || pending.State != GameOver {
		t.Fatal("failed replay left an empty active reservation", err)
	}
}

func TestDeletingResultsDoesNotCloseAnIndependentlyOpenedRematch(t *testing.T) {
	source, host, _, _ := roomFixture(t, true)
	source.State = GameOver
	target, _, _, _ := roomFixture(t, true)
	target.League.MatchID = "another-room"
	closed, err := source.CloseResultsAndPendingSession("room", host.AccountID, target, "another-room")
	if err != nil || closed || target.League.Cancelled || target.State != Unstarted {
		t.Fatal("an independently occupied rematch was closed", err)
	}
}
