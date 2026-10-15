package game

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/gofrs/uuid/v5"
	"github.com/lxzan/gws"
)

const roomPreset = "/api/avatar-presets/v1/7-5-4-5-6-7-9-7-7.svg"
const profilePhoto = "/api/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

func roomFixture(t *testing.T, managed bool) (*Lobby, *Player, *Player, *Player) {
	t.Helper()
	host, l, err := CreateLobby("", "Host", "english", &EditableLobbySettings{Rounds: 2, DrawingTime: 60, MaxPlayers: 10, WordsPerTurn: 3}, nil, CompetitiveScoring)
	if err != nil {
		t.Fatal(err)
	}
	l.WriteObject = noOpWriteObject
	l.WritePreparedMessage = noOpWritePreparedMessage
	guest := l.JoinPlayer("Guest")
	spec := l.JoinPlayer("Viewer")
	spec.SpectatorOnly = true
	spec.State = Spectating
	if managed {
		l.League = &LeagueState{MatchID: "room", Mode: "private", Emit: func(LeagueEvent) bool { return true }}
	}
	for _, p := range l.players {
		p.Connected = true
		p.AccountID = p.Name
		l.ApplyProfileIdentity(p, p.Name, profilePhoto)
		if managed {
			l.RegisterLeaguePlayer(p)
		}
	}
	t.Cleanup(func() { l.Synchronized(func() { l.timeLeftTicker = nil; l.State = GameOver }) })
	return l, host, guest, spec
}
func changeLook(l *Lobby, p *Player, name, avatar string) error {
	b, _ := json.Marshal(Event{Type: EventTypeRoomIdentityChange, Data: RoomIdentity{name, avatar}})
	return l.HandleEvent(EventTypeRoomIdentityChange, b, p)
}
func command(l *Lobby, p *Player, kind string) error { return l.HandleEvent(kind, nil, p) }

func TestManagedHostExplicitStartAndReadiness(t *testing.T) {
	l, host, guest, spec := roomFixture(t, true)
	if command(l, host, EventTypeToggleReadiness) == nil {
		t.Fatal("host readied")
	}
	for _, p := range []*Player{guest, spec} {
		if command(l, p, EventTypeStart) == nil {
			t.Fatal("non-host started")
		}
	}
	if command(l, host, EventTypeStart) == nil {
		t.Fatal("unready guest did not block start")
	}
	if command(l, spec, EventTypeToggleReadiness) == nil || changeLook(l, spec, "Spoof", roomPreset) == nil {
		t.Fatal("spectator mutated room")
	}
	guest.Connected = false
	if command(l, host, EventTypeStart) == nil {
		t.Fatal("solo host started")
	}
	guest.Connected = true
	if command(l, guest, EventTypeToggleReadiness) != nil || l.State != Unstarted {
		t.Fatal("managed ready auto-started")
	}
	if command(l, host, EventTypeStart) != nil || l.State != Ongoing {
		t.Fatal("ready crew failed to start")
	}
	if changeLook(l, guest, "Too late", roomPreset) == nil || command(l, guest, EventTypeToggleReadiness) == nil {
		t.Fatal("mutated running match")
	}
}

func TestUnmanagedReadinessRetainsAutoStart(t *testing.T) {
	l, host, guest, spec := roomFixture(t, false)
	spec.Connected = false
	if changeLook(l, guest, "Room", roomPreset) == nil {
		t.Fatal("room identity accepted in native lobby")
	}
	_ = command(l, host, EventTypeToggleReadiness)
	if l.State != Unstarted {
		t.Fatal("premature start")
	}
	_ = command(l, guest, EventTypeToggleReadiness)
	if l.State != Ongoing {
		t.Fatal("native ready behavior changed")
	}
}

func TestRoomIdentityValidationBroadcastAndReadiness(t *testing.T) {
	l, _, guest, _ := roomFixture(t, true)
	broadcasts := map[uuid.UUID]int{}
	l.WritePreparedMessage = func(p *Player, _ *gws.Broadcaster) error { broadcasts[p.ID]++; return nil }
	guest.State = Ready
	if err := changeLook(l, guest, "  "+strings.Repeat("界", 35)+"\n", roomPreset); err != nil {
		t.Fatal(err)
	}
	if guest.State != Standby || utf8.RuneCountInString(guest.Name) != 30 || !utf8.ValidString(guest.Name) {
		t.Fatal("unsafe name or readiness")
	}
	for _, p := range l.players {
		if broadcasts[p.ID] != 1 {
			t.Fatal("snapshot not broadcast to everyone")
		}
	}
	if guest.ProfileIdentity.DisplayName != "Guest" || guest.ProfileIdentity.AvatarURL != profilePhoto {
		t.Fatal("profile mutated")
	}
	for _, bad := range []string{"", " ", "\n\t", "\u200b\u202e"} {
		if changeLook(l, guest, bad, roomPreset) == nil {
			t.Fatalf("empty name accepted: %q", bad)
		}
	}
	for _, bad := range []string{"https://x.test/a", "//x.test/a", "data:image/png,x", "blob:x", "javascript:x", "/api/media/../x", "/api/media/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "/api/avatar-presets/v1/8-0-0-0-0-0-0-0-0.svg", "/api/avatar-presets/v1/02-0-0-0-0-0-0-0-0.svg"} {
		if changeLook(l, guest, "Guest", bad) == nil {
			t.Fatalf("bad avatar accepted: %s", bad)
		}
	}
	for _, payload := range []string{`{`, `{"data":null}`, `{"data":{"displayName":"a","avatarUrl":null}}`, `{"data":{"displayName":"a","avatarUrl":"","extra":true}}`, strings.Repeat("x", 2049)} {
		if l.HandleEvent(EventTypeRoomIdentityChange, []byte(payload), guest) == nil {
			t.Fatal("malformed payload accepted")
		}
	}
	for i, bound := range PresetAvatarBounds {
		parts := []string{"0", "0", "0", "0", "0", "0", "0", "0", "0"}
		parts[i] = strconv.Itoa(bound)
		if ValidPresetAvatarURL("/api/avatar-presets/v1/" + strings.Join(parts, "-") + ".svg") {
			t.Fatal("out-of-range preset accepted")
		}
	}
	if err := changeLook(l, guest, "<b>literal text</b>", profilePhoto); err != nil {
		t.Fatal("own profile image rejected")
	}
	if err := changeLook(l, guest, guest.ProfileIdentity.DisplayName, guest.ProfileIdentity.AvatarURL); err != nil || guest.roomIdentityOverride {
		t.Fatal("restore did not clear override")
	}
}

func TestProfileRefreshPreservesRoomOverrideAndNewSeatResets(t *testing.T) {
	l, _, guest, _ := roomFixture(t, true)
	_ = changeLook(l, guest, "Room guest", roomPreset)
	l.ApplyProfileIdentity(guest, "Updated profile", profilePhoto)
	if guest.Name != "Room guest" || guest.AvatarURL != roomPreset || guest.ProfileIdentity.DisplayName != "Updated profile" {
		t.Fatal("admission erased override")
	}
	fresh := l.JoinPlayer("New seat")
	l.ApplyProfileIdentity(fresh, "Updated profile", profilePhoto)
	if fresh.Name != "Updated profile" || fresh.AvatarURL != profilePhoto || fresh.roomIdentityOverride {
		t.Fatal("new seat inherited room override")
	}
	l.State = Ongoing
	l.ApplyProfileIdentity(fresh, "Later profile", roomPreset)
	if fresh.Name != "Later profile" || fresh.AvatarURL != profilePhoto {
		t.Fatal("profile name did not refresh or in-game avatar changed")
	}
}

func TestRoomIdentityRejectsReplacedSocketAndTransfersOwner(t *testing.T) {
	l, host, guest, _ := roomFixture(t, true)
	old, current := &gws.Conn{}, &gws.Conn{}
	guest.ws = current
	if err := l.HandleSocketEvent(EventTypeRoomIdentityChange, []byte(`{"data":{"displayName":"Stale","avatarUrl":""}}`), guest, old); err != nil || guest.Name != "Guest" {
		t.Fatal("stale socket changed identity")
	}
	_ = l.HandleSocketEvent(EventTypeToggleReadiness, nil, guest, old)
	if guest.State != Standby {
		t.Fatal("stale socket changed readiness")
	}
	guest.ws = nil
	guest.State = Ready
	// Existing kick/removal flow selects the next connected non-spectator owner.
	kickPlayer(l, host, 0)
	if l.OwnerID != guest.ID || guest.State != Standby {
		t.Fatal("host transfer kept ready state")
	}
	if command(l, guest, EventTypeToggleReadiness) == nil {
		t.Fatal("new host can ready")
	}
	if command(l, guest, EventTypeStart) == nil {
		t.Fatal("new host started alone")
	}
}

func TestConcurrentStartEditAndReadyRemainSerialized(t *testing.T) {
	l, host, guest, _ := roomFixture(t, true)
	var wg sync.WaitGroup
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			switch i % 3 {
			case 0:
				_ = command(l, host, EventTypeStart)
			case 1:
				_ = command(l, guest, EventTypeToggleReadiness)
			case 2:
				_ = changeLook(l, guest, "Different", roomPreset)
			}
		}(i)
	}
	wg.Wait()
	l.Synchronized(func() {
		if l.State == Unstarted && guest.State != Ready && l.managedStartError() == nil {
			t.Error("start bypassed readiness")
		}
	})
	if l.State == Ongoing {
		before := guest.Name
		_ = changeLook(l, guest, "Late", roomPreset)
		if guest.Name != before {
			t.Fatal("late edit succeeded")
		}
	}
}
