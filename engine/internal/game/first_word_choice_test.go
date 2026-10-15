package game

import "testing"

func TestFirstManagedTurnOffersConfiguredWordsAndExplainsPenalty(t *testing.T) {
	for _, pending := range []bool{false, true} {
		name := "normal"
		if pending {
			name = "carried-penalty"
		}
		t.Run(name, func(t *testing.T) {
			l, host, guest, _ := roomFixture(t, true)
			host.HardWordPending = pending
			guest.State = Ready
			var offered *YourTurn
			l.WriteObject = func(player *Player, message any) error {
				if event, ok := message.(*Event); ok && event.Type == EventTypeYourTurn {
					if player != host {
						t.Error("first word choices went to the wrong drawer")
					}
					offered = event.Data.(*YourTurn)
				}
				return nil
			}
			if err := l.HandleEvent(EventTypeStart, nil, host); err != nil {
				t.Fatal(err)
			}
			if offered == nil || l.Round != 1 || host.State != Drawing {
				t.Fatal("first drawer did not receive word choices")
			}
			wanted := 3
			if pending {
				wanted = 1
			}
			if len(offered.Words) != wanted || offered.HardWord != pending {
				t.Fatalf("wrong first-turn choices or reason: %+v", offered)
			}
			if offered.PreSelectedWord < 0 || offered.PreSelectedWord >= len(offered.Words) {
				t.Fatal("automatic selection is outside the word choices")
			}
			// Reopening the drawer's connection must preserve choices and reason.
			original := append([]string{}, offered.Words...)
			l.SendYourTurnEvent(host)
			if offered.HardWord != pending || len(offered.Words) != len(original) {
				t.Fatal("reconnecting changed the word-choice offer")
			}
			for i, word := range original {
				if word == "" || offered.Words[i] != word {
					t.Fatal("empty or changed word choice")
				}
			}
		})
	}
}
