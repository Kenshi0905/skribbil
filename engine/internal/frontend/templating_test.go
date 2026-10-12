package frontend

import (
	"bytes"
	"regexp"
	"strings"
	"testing"

	"github.com/scribble-rs/scribble.rs/internal/api"
	"github.com/scribble-rs/scribble.rs/internal/config"
	"github.com/scribble-rs/scribble.rs/internal/translations"
	"github.com/stretchr/testify/require"
)

func TestManagedSpectatorControlsBeforeSocketConnects(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name      string
		mode      string
		spectator bool
	}{
		{name: "native"},
		{name: "managed player", mode: "private"},
		{name: "managed spectator", mode: "private", spectator: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var buffer bytes.Buffer
			err := pageTemplates.ExecuteTemplate(&buffer, "lobby-page", &lobbyPageData{
				BasePageConfig:  &BasePageConfig{checksums: make(map[string]string)},
				LobbyData:       &api.LobbyData{SettingBounds: config.Default.LobbySettingBounds, GameConstants: api.GameConstantsData},
				Translation:     translations.DefaultTranslation,
				LeagueMode:      test.mode,
				LeagueSpectator: test.spectator,
			})
			require.NoError(t, err)
			html := buffer.String()
			require.Equal(t, test.mode != "", strings.Contains(html, `data-league-mode="private"`))
			for _, id := range []string{"ready-state-start", "message-input", "message-send", "ready-state-game-over"} {
				tag := regexp.MustCompile(`<[^>]+id="` + id + `"[^>]*>`).FindString(html)
				require.NotEmpty(t, tag)
				wantDisabled := test.spectator || (id == "ready-state-game-over" && test.mode != "")
				require.Equal(t, wantDisabled, strings.Contains(tag, " disabled"), id)
			}
			require.Equal(t, test.spectator, strings.Contains(html, `placeholder="Spectating — chat disabled"`))
		})
	}
}

func Test_templateLobbyPage(t *testing.T) {
	t.Parallel()

	var buffer bytes.Buffer
	err := pageTemplates.ExecuteTemplate(&buffer,
		"lobby-page", &lobbyPageData{
			BasePageConfig: &BasePageConfig{
				checksums: make(map[string]string),
			},
			LobbyData: &api.LobbyData{
				SettingBounds: config.Default.LobbySettingBounds,
				GameConstants: api.GameConstantsData,
			},
			Translation: translations.DefaultTranslation,
		})
	if err != nil {
		t.Errorf("Error templating: %s", err)
	}
}

func Test_templateErrorPage(t *testing.T) {
	t.Parallel()

	var buffer bytes.Buffer
	err := pageTemplates.ExecuteTemplate(&buffer,
		"error-page", &errorPageData{
			BasePageConfig: &BasePageConfig{},
			ErrorMessage:   "KEK",
			Translation:    translations.DefaultTranslation,
			Locale:         "en-US",
		})
	if err != nil {
		t.Errorf("Error templating: %s", err)
	}
}

func Test_templateIndexPage(t *testing.T) {
	t.Parallel()

	handler, err := NewHandler(&config.Config{})
	require.NoError(t, err)
	createPageData := handler.createDefaultIndexPageData()
	createPageData.Translation = translations.DefaultTranslation

	var buffer bytes.Buffer
	if err := pageTemplates.ExecuteTemplate(&buffer, "index", createPageData); err != nil {
		t.Errorf("Error templating: %s", err)
	}
}
