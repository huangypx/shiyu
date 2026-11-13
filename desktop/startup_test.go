package desktop

import "testing"

func TestBackgroundStartupKeepsManualLaunchPreference(t *testing.T) {
	if BackgroundStartup(false, nil) {
		t.Fatal("a manual launch must keep the main window")
	}
	if !BackgroundStartup(false, []string{"--background"}) {
		t.Fatal("login launch must run in the background")
	}
	if !BackgroundStartup(true, nil) {
		t.Fatal("the saved background preference must remain effective")
	}
}
