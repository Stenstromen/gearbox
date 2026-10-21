//go:build darwin

package main

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stenstromen/gearbox/config"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

func TestFinishedDownloadNotifiesOnce(t *testing.T) {
	notifier := &fakeNotifier{}
	service := &TransmissionService{}
	service.setNotifier(notifier)

	service.noteFinishedDownloads([]Torrent{
		{ID: 1, Name: "Alpha", Status: "Downloading", PercentDone: 0.4},
		{ID: 7, Name: "Already", Status: "Seeding", PercentDone: 1},
		{ID: 8, Name: "Paused", Status: "Stopped", PercentDone: 1},
	})
	if got := notifier.notifications(); len(got) != 0 {
		t.Fatalf("first sight notified: %+v", got)
	}

	service.noteFinishedDownloads([]Torrent{
		{ID: 1, Name: "Alpha", Status: "Seeding", PercentDone: 1},
		{ID: 7, Name: "Already", Status: "Seeding", PercentDone: 1},
		{ID: 8, Name: "Paused", Status: "Stopped", PercentDone: 1},
	})
	got := notifier.notifications()
	if len(got) != 1 || got[0].ID != "gearbox-download-1" || got[0].Title != "Alpha" || got[0].Body != "Download finished" {
		t.Fatalf("notifications = %+v", got)
	}

	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Seeding", PercentDone: 1}})
	if got := notifier.notifications(); len(got) != 1 {
		t.Fatalf("repeated poll notified again: %+v", got)
	}
}

func TestFinishedDownloadNotifiesAgainAfterItRestarts(t *testing.T) {
	notifier := &fakeNotifier{}
	service := &TransmissionService{}
	service.setNotifier(notifier)

	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Downloading", PercentDone: 0.4}})
	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Queued to seed", PercentDone: 1}})
	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Downloading", PercentDone: 0.1}})
	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Stopped", PercentDone: 1}})

	if got := notifier.notifications(); len(got) != 2 {
		t.Fatalf("notifications = %+v", got)
	}
}

func TestVerifyDoesNotLookLikeAFinishedDownload(t *testing.T) {
	notifier := &fakeNotifier{}
	service := &TransmissionService{}
	service.setNotifier(notifier)

	service.noteFinishedDownloads([]Torrent{{ID: 2, Name: "Beta", Status: "Seeding", PercentDone: 1}})
	service.noteFinishedDownloads([]Torrent{{ID: 2, Name: "Beta", Status: "Verifying", PercentDone: 0.2}})
	service.noteFinishedDownloads([]Torrent{{ID: 2, Name: "Beta", Status: "Seeding complete", PercentDone: 1}})
	if got := notifier.notifications(); len(got) != 0 {
		t.Fatalf("verify notified: %+v", got)
	}

	service.noteFinishedDownloads([]Torrent{{ID: 3, Name: "Gamma", Status: "Queued to verify", PercentDone: 0.2}})
	service.noteFinishedDownloads([]Torrent{{ID: 3, Name: "Gamma", Status: "Downloading", PercentDone: 0.2}})
	service.noteFinishedDownloads([]Torrent{{ID: 3, Name: "Gamma", Status: "Seeding", PercentDone: 1}})
	got := notifier.notifications()
	if len(got) != 1 || got[0].Title != "Gamma" {
		t.Fatalf("notifications = %+v", got)
	}
}

func TestRemovedTorrentDoesNotNotifyWhenItReturnsComplete(t *testing.T) {
	notifier := &fakeNotifier{}
	service := &TransmissionService{}
	service.setNotifier(notifier)

	service.noteFinishedDownloads([]Torrent{{ID: 4, Name: "Delta", Status: "Downloading", PercentDone: 0.5}})
	service.noteFinishedDownloads(nil)
	service.noteFinishedDownloads([]Torrent{{ID: 4, Name: "Delta", Status: "Seeding", PercentDone: 1}})
	if got := notifier.notifications(); len(got) != 0 {
		t.Fatalf("readded complete torrent notified: %+v", got)
	}
}

func TestFinishNotificationRespectsPreference(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	store, err := config.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	prefs, err := store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	prefs.NotifyOnFinish = false
	if err := store.Save(prefs); err != nil {
		t.Fatal(err)
	}

	notifier := &fakeNotifier{}
	service := &TransmissionService{store: store}
	service.setNotifier(notifier)
	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Downloading", PercentDone: 0.2}})
	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Seeding", PercentDone: 1}})
	if got := notifier.notifications(); len(got) != 0 {
		t.Fatalf("disabled preference notified: %+v", got)
	}

	prefs.NotifyOnFinish = true
	if err := store.Save(prefs); err != nil {
		t.Fatal(err)
	}
	service.noteFinishedDownloads([]Torrent{{ID: 1, Name: "Alpha", Status: "Seeding", PercentDone: 1}})
	if got := notifier.notifications(); len(got) != 0 {
		t.Fatalf("missed finish was repeated after enabling: %+v", got)
	}
}

func TestFinishNotificationUsesDownloadWhenNameIsBlank(t *testing.T) {
	notifier := &fakeNotifier{}
	service := &TransmissionService{}
	service.setNotifier(notifier)
	service.noteFinishedDownloads([]Torrent{{ID: 9, Status: "Queued to download", PercentDone: 0}})
	service.noteFinishedDownloads([]Torrent{{ID: 9, Status: "Stopped", PercentDone: 1}})
	got := notifier.notifications()
	if len(got) != 1 || got[0].Title != "Download" {
		t.Fatalf("notifications = %+v", got)
	}
}

func TestNotificationPermission(t *testing.T) {
	service := &TransmissionService{}
	missing := service.GetNotificationPermission()
	if missing.Available || missing.Authorized || !strings.Contains(missing.Message, "not available") {
		t.Fatalf("missing = %+v", missing)
	}
	if _, err := service.RequestNotificationPermission(); err == nil {
		t.Fatal("expected an error without a notification service")
	}
	if err := service.SendTestNotification(); err == nil {
		t.Fatal("expected the test notification to be refused")
	}

	notifier := &fakeNotifier{}
	service.setNotifier(notifier)
	denied := service.GetNotificationPermission()
	if denied.Authorized || !denied.Available || !strings.Contains(denied.Message, "not allowed yet") {
		t.Fatalf("denied = %+v", denied)
	}

	notifier.authorized = true
	allowed := service.GetNotificationPermission()
	if !allowed.Authorized || allowed.Message != "Notifications are allowed." {
		t.Fatalf("allowed = %+v", allowed)
	}

	notifier.checkErr = errors.New("boom")
	failed := service.GetNotificationPermission()
	if failed.Authorized || !failed.Available || failed.Message != "boom" {
		t.Fatalf("check error = %+v", failed)
	}
	notifier.checkErr = nil
	notifier.authorized = false

	notifier.requestErr = errors.New("prompt failed")
	if _, err := service.RequestNotificationPermission(); err == nil || !notifier.requested {
		t.Fatalf("request error = %v requested=%v", err, notifier.requested)
	}
	notifier.requestErr = nil
	notifier.requestOK = false
	refused, err := service.RequestNotificationPermission()
	if err != nil || refused.Authorized || !strings.Contains(refused.Message, "Gearbox") {
		t.Fatalf("refused = %+v err=%v", refused, err)
	}
	notifier.requestOK = true
	granted, err := service.RequestNotificationPermission()
	if err != nil || !granted.Authorized || granted.Message != "Notifications are allowed." {
		t.Fatalf("granted = %+v err=%v", granted, err)
	}

	if err := service.SendTestNotification(); err != nil {
		t.Fatal(err)
	}
	got := notifier.notifications()
	if len(got) != 1 || !strings.HasPrefix(got[0].ID, "gearbox-test-") || got[0].Title != "Gearbox" || got[0].Body != "Test notification — you’re all set." {
		t.Fatalf("test notification = %+v", got)
	}
}

func TestNotificationFallsBackToAppleScript(t *testing.T) {
	var script string
	original := startNotificationScript
	startNotificationScript = func(value string) error {
		script = value
		return nil
	}
	t.Cleanup(func() { startNotificationScript = original })

	service := &TransmissionService{}
	service.upsertNotification("id", `Say "hi"`, `Body \ now`)
	if script != `display notification "Body \\ now" with title "Say \"hi\""` {
		t.Fatalf("script = %s", script)
	}

	script = ""
	notifier := &fakeNotifier{updateErr: errors.New("missing"), sendErr: errors.New("missing")}
	service.setNotifier(notifier)
	service.upsertNotification("id", "Title", "Body")
	if script != `display notification "Body" with title "Title"` {
		t.Fatalf("script = %s", script)
	}

	script = ""
	notifier.updateErr = nil
	service.upsertNotification("id", "Title", "Body")
	if script != "" || len(notifier.sent) != 1 {
		t.Fatalf("script = %s sent = %+v", script, notifier.sent)
	}
}

func TestAppleScriptString(t *testing.T) {
	if got := appleScriptString(`say "hi" \`); got != `"say \"hi\" \\"` {
		t.Fatalf("quoted = %s", got)
	}
}

type fakeNotifier struct {
	authorized bool
	requestOK  bool
	requested  bool
	checkErr   error
	requestErr error
	updateErr  error
	sendErr    error
	updated    []notifications.NotificationOptions
	sent       []notifications.NotificationOptions
}

func (f *fakeNotifier) CheckNotificationAuthorization() (bool, error) {
	return f.authorized, f.checkErr
}

func (f *fakeNotifier) RequestNotificationAuthorization() (bool, error) {
	f.requested = true
	if f.requestErr != nil {
		return false, f.requestErr
	}
	if f.requestOK {
		f.authorized = true
	}
	return f.requestOK, nil
}

func (f *fakeNotifier) SendNotification(options notifications.NotificationOptions) error {
	f.sent = append(f.sent, options)
	return f.sendErr
}

func (f *fakeNotifier) UpdateNotification(options notifications.NotificationOptions) error {
	if f.updateErr != nil {
		return f.updateErr
	}
	f.updated = append(f.updated, options)
	return nil
}

func (f *fakeNotifier) notifications() []notifications.NotificationOptions {
	return append(append([]notifications.NotificationOptions{}, f.updated...), f.sent...)
}
