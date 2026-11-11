package desktop

import "testing"

func TestXbindKeyExpression(t *testing.T) {
	tests := map[string]string{
		"Ctrl+Shift+Space": "control+shift+space",
		"Cmd+Alt+K":        "mod4+alt+k",
		"Ctrl+Esc":         "control+escape",
	}
	for input, want := range tests {
		got, err := xbindKeyExpression(input)
		if err != nil {
			t.Fatalf("xbindKeyExpression(%q): %v", input, err)
		}
		if got != want {
			t.Errorf("xbindKeyExpression(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestXbindKeyExpressionRejectsEmptyParts(t *testing.T) {
	if _, err := xbindKeyExpression("Ctrl++Space"); err == nil {
		t.Fatal("expected empty hotkey part to be rejected")
	}
}
