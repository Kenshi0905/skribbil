package game

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const EventTypeRoomIdentityChange = "room-identity-change"

// Stable v1 order: hair, eyes, brows, mouth, extras, skin, hair color,
// shirt, background. tests/avatar.test.mjs checks parity with web/avatar.js.
var PresetAvatarBounds = [...]int{8, 6, 5, 6, 7, 8, 10, 8, 8}

// v2: face, hair, eyes, brows, nose, mouth, ears, extras and four colors.
var PresetAvatarV2Bounds = [...]int{7, 24, 16, 5, 6, 16, 6, 22, 8, 10, 8, 8}

func ValidPresetAvatarURL(url string) bool {
	prefix := "/api/avatar-presets/v1/"
	bounds := PresetAvatarBounds[:]
	if strings.HasPrefix(url, "/api/avatar-presets/v2/") {
		prefix = "/api/avatar-presets/v2/"
		bounds = PresetAvatarV2Bounds[:]
	}
	if !strings.HasPrefix(url, prefix) || !strings.HasSuffix(url, ".svg") {
		return false
	}
	parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(url, prefix), ".svg"), "-")
	if len(parts) != len(bounds) {
		return false
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 || n >= bounds[i] || strconv.Itoa(n) != part {
			return false
		}
	}
	return true
}

type RoomIdentity struct {
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
}

func cleanRoomName(name string) string {
	name = strings.Map(func(r rune) rune {
		// Strip control/bidi formatting; retain ordinary Unicode and emoji joiners.
		if unicode.IsControl(r) || (unicode.Is(unicode.Cf, r) && r != '\u200d') {
			return -1
		}
		return r
	}, name)
	runes := []rune(strings.TrimSpace(name))
	if len(runes) > 30 {
		runes = runes[:30]
	}
	return strings.TrimSpace(string(runes))
}

// ApplyProfileIdentity requires the lobby mutex. Re-admission refreshes the
// trusted baseline without overwriting a room override or an in-game identity.
func (lobby *Lobby) ApplyProfileIdentity(p *Player, name, avatar string) {
	p.ProfileIdentity = RoomIdentity{DisplayName: cleanRoomName(name), AvatarURL: avatar}
	if !p.profileInitialized || (lobby.State == Unstarted && !p.roomIdentityOverride) {
		if p.State == Ready && (p.Name != p.ProfileIdentity.DisplayName || p.AvatarURL != avatar) {
			p.State = Standby
		}
		p.Name, p.AvatarURL = p.ProfileIdentity.DisplayName, avatar
	}
	p.profileInitialized = true
}

func (lobby *Lobby) changeRoomIdentity(p *Player, payload []byte) error {
	if lobby.League == nil || lobby.State != Unstarted {
		return errors.New("room looks can only change before a managed match starts")
	}
	if p.SpectatorOnly || p.State == Spectating || !p.Connected {
		return errors.New("only connected players can change their room look")
	}
	if len(payload) > 2048 || !utf8.Valid(payload) {
		return errors.New("room look is too large or invalid")
	}
	var request struct {
		Type string `json:"type"`
		Data *struct {
			DisplayName *string `json:"displayName"`
			AvatarURL   *string `json:"avatarUrl"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || request.Data == nil || request.Data.DisplayName == nil || request.Data.AvatarURL == nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("choose a room name and a valid avatar")
	}
	name := cleanRoomName(*request.Data.DisplayName)
	if name == "" {
		return errors.New("enter a room name with at least one visible character")
	}
	avatar := *request.Data.AvatarURL
	if avatar != p.ProfileIdentity.AvatarURL && !ValidPresetAvatarURL(avatar) {
		return errors.New("choose your own profile picture or a valid preset character")
	}
	if name != p.Name || avatar != p.AvatarURL {
		p.Name, p.AvatarURL = name, avatar
		if p.State == Ready {
			p.State = Standby
		}
	}
	p.roomIdentityOverride = name != p.ProfileIdentity.DisplayName || avatar != p.ProfileIdentity.AvatarURL
	lobby.Broadcast(&Event{Type: EventTypeUpdatePlayers, Data: lobby.players})
	return nil
}

// Called only under the lobby mutex, both for explicit start and startGame.
func (lobby *Lobby) managedStartError() error {
	if lobby.State != Unstarted {
		return errors.New("this match has already started")
	}
	connected := 0
	for _, p := range lobby.players {
		if !p.Connected || p.SpectatorOnly || p.State == Spectating {
			continue
		}
		connected++
		if p.ID != lobby.OwnerID && p.State != Ready {
			return errors.New("wait until every connected guest is ready")
		}
	}
	if connected < 2 {
		return errors.New("at least two connected players are needed")
	}
	return nil
}
