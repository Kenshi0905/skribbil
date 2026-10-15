package game

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/lxzan/gws"
)

func captureVoteNotices(t *testing.T, lobby *Lobby, eventType string) *[]json.RawMessage {
	t.Helper()
	notices := []json.RawMessage{}
	recipient := lobby.players[0]
	lobby.WritePreparedMessage = func(player *Player, message *gws.Broadcaster) error {
		if player != recipient {
			return nil
		}
		payload := getUnexportedField(reflect.ValueOf(message).Elem().FieldByName("payload")).([]byte)
		var event struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(payload, &event); err != nil {
			t.Fatal(err)
		}
		if event.Type == eventType {
			notices = append(notices, event.Data)
		}
		return nil
	}
	return &notices
}

func TestDislikeNoticesNameVoterAndReportFrozenQuorum(t *testing.T) {
	l, artist, a, b, spec := penaltyFixture()
	artist.Name, a.Name, b.Name = "Artist", "Alice", "Bob"
	notices := captureVoteNotices(t, l, EventTypeDrawingDisliked)
	_ = vote(l, a, 1)
	_ = vote(l, a, 1) // Repeated clicks do not repeat the chat notice.
	_ = vote(l, b, 0)
	_ = vote(l, artist, 1)
	_ = vote(l, spec, 1)
	if len(*notices) != 1 {
		t.Fatalf("invalid or duplicate votes produced notices: %d", len(*notices))
	}
	var first DrawingDislikeVote
	_ = json.Unmarshal((*notices)[0], &first)
	if first.VoterID != a.ID || first.VoterName != "Alice" || first.ArtistName != "Artist" || first.Votes != 1 || first.Required != 2 || first.Applied {
		t.Fatalf("incorrect first vote notice: %+v", first)
	}
	_ = vote(l, b, 1)
	_ = vote(l, b, 1)
	if len(*notices) != 2 {
		t.Fatalf("final vote was missing or duplicated: %d", len(*notices))
	}
	var final DrawingDislikeVote
	_ = json.Unmarshal((*notices)[1], &final)
	if final.VoterID != b.ID || final.VoterName != "Bob" || final.Votes != 2 || final.Required != 2 || !final.Applied || artist.Score != -60 {
		t.Fatalf("incorrect penalty notice: %+v", final)
	}
	l.beginDislikes()
	if len(*notices) != 2 {
		t.Fatal("state snapshots or a new turn replayed old votes")
	}
}

func TestKickNoticesIdentifyEachVoterAndKeepExistingQuorum(t *testing.T) {
	l, host, guest, spec := roomFixture(t, true)
	third := l.JoinPlayer("Third player")
	third.Connected = true
	notices := captureVoteNotices(t, l, EventTypeKickVote)
	cast := func(voter *Player, target uuid.UUID) {
		payload, _ := json.Marshal(map[string]any{"data": target})
		_ = l.HandleEvent(EventTypeKickVote, payload, voter)
	}
	cast(host, guest.ID)
	cast(host, guest.ID)
	cast(guest, guest.ID)
	cast(spec, guest.ID)
	cast(third, uuid.Must(uuid.NewV4()))
	if len(*notices) != 1 {
		t.Fatalf("invalid or duplicate kick votes produced notices: %d", len(*notices))
	}
	var first KickVote
	_ = json.Unmarshal((*notices)[0], &first)
	if first.VoterID != host.ID || first.VoterName != "Host" || first.PlayerID != guest.ID || first.PlayerName != "Guest" || first.VoteCount != 1 || first.RequiredVoteCount != 2 {
		t.Fatalf("incorrect kick progress: %+v", first)
	}
	cast(third, guest.ID)
	if len(*notices) != 2 {
		t.Fatalf("missing final kick vote: %d", len(*notices))
	}
	var final KickVote
	_ = json.Unmarshal((*notices)[1], &final)
	if final.VoterID != third.ID || final.VoterName != "Third player" || final.VoteCount != 2 || final.RequiredVoteCount != 2 {
		t.Fatalf("incorrect final kick notice: %+v", final)
	}
	for _, p := range l.players {
		if p.ID == guest.ID {
			t.Fatal("reaching the displayed quorum did not remove the target")
		}
	}
}
