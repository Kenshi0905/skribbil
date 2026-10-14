package game

import (
	"strconv"
	"strings"
	"testing"
)

func TestAvatarV2CanonicalBounds(t *testing.T) {
	const valid = "/api/avatar-presets/v2/2-9-6-3-0-7-2-12-1-1-0-0.svg"
	if !ValidPresetAvatarURL(valid) {
		t.Fatal("valid v2 rejected")
	}
	for i, bound := range PresetAvatarV2Bounds {
		parts := []string{"2", "9", "6", "3", "0", "7", "2", "12", "1", "1", "0", "0"}
		parts[i] = strconv.Itoa(bound)
		if ValidPresetAvatarURL("/api/avatar-presets/v2/" + strings.Join(parts, "-") + ".svg") {
			t.Fatal("out-of-range accepted", i)
		}
	}
	for _, bad := range []string{valid + "?x=1", valid + "?", strings.Replace(valid, "/2-", "/02-", 1), strings.Replace(valid, "/v2/", "/v3/", 1), "https://host" + valid, "/api/avatar-presets/v2/../v1/2-0.svg"} {
		if ValidPresetAvatarURL(bad) {
			t.Fatal("noncanonical accepted", bad)
		}
	}
}
