//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// statusNotifier is the slice of the Wails notification service Gearbox uses.
type statusNotifier interface {
	CheckNotificationAuthorization() (bool, error)
	RequestNotificationAuthorization() (bool, error)
	SendNotification(notifications.NotificationOptions) error
	UpdateNotification(notifications.NotificationOptions) error
}

// startNotificationScript delivers a notification when the Wails service cannot.
// Unsigned `go run` builds need this fallback. Tests replace it.
var startNotificationScript = func(script string) error {
	return exec.Command("osascript", "-e", script).Start()
}

// setNotifier attaches the macOS notification service.
func (s *TransmissionService) setNotifier(notifier statusNotifier) {
	s.notifyMu.Lock()
	s.notifier = notifier
	s.notifyMu.Unlock()
}

// noteFinishedDownloads alerts when a torrent Gearbox has seen downloading
// reaches a complete state. The first sight of a torrent never alerts, so
// torrents that were already finished at launch stay quiet.
func (s *TransmissionService) noteFinishedDownloads(torrents []Torrent) {
	finished := s.takeFinishedDownloads(torrents)
	if len(finished) == 0 || !s.notifyOnFinish() {
		return
	}
	for _, torrent := range finished {
		s.upsertNotification(fmt.Sprintf("gearbox-download-%d", torrent.ID), downloadTitle(torrent), "Download finished")
	}
}

func (s *TransmissionService) takeFinishedDownloads(torrents []Torrent) []Torrent {
	s.notifyMu.Lock()
	defer s.notifyMu.Unlock()
	if s.downloadSeen == nil {
		s.downloadSeen = make(map[int]bool)
	}
	present := make(map[int]struct{}, len(torrents))
	finished := make([]Torrent, 0)
	for _, torrent := range torrents {
		present[torrent.ID] = struct{}{}
		incomplete := downloadIncomplete(torrent)
		wasIncomplete, seen := s.downloadSeen[torrent.ID]
		if seen && wasIncomplete && downloadComplete(torrent) {
			finished = append(finished, torrent)
		}
		switch {
		case !seen:
			s.downloadSeen[torrent.ID] = incomplete
		case incomplete:
			s.downloadSeen[torrent.ID] = true
		case downloadComplete(torrent):
			s.downloadSeen[torrent.ID] = false
		}
	}
	for id := range s.downloadSeen {
		if _, ok := present[id]; !ok {
			delete(s.downloadSeen, id)
		}
	}
	return finished
}

func (s *TransmissionService) notifyOnFinish() bool {
	if s.store == nil {
		return true
	}
	prefs, err := s.store.Preferences()
	if err != nil {
		return false
	}
	return prefs.NotifyOnFinish
}

func downloadComplete(torrent Torrent) bool {
	switch torrent.Status {
	case "Seeding", "Queued to seed", "Seeding complete":
		return true
	default:
		return torrent.PercentDone >= 1
	}
}

func downloadIncomplete(torrent Torrent) bool {
	if downloadComplete(torrent) {
		return false
	}
	switch torrent.Status {
	case "Verifying", "Queued to verify":
		return false
	default:
		return true
	}
}

func downloadTitle(torrent Torrent) string {
	name := strings.TrimSpace(torrent.Name)
	if name == "" {
		return "Download"
	}
	return name
}

// NotificationPermission describes macOS notification authorization state.
type NotificationPermission struct {
	Authorized bool   `json:"authorized"`
	Available  bool   `json:"available"`
	Message    string `json:"message"`
}

// GetNotificationPermission returns the current notification authorization state.
func (s *TransmissionService) GetNotificationPermission() NotificationPermission {
	notifier := s.currentNotifier()
	if notifier == nil {
		return NotificationPermission{
			Available: false,
			Message:   "Notification service is not available.",
		}
	}
	ok, err := notifier.CheckNotificationAuthorization()
	if err != nil {
		return NotificationPermission{
			Available: true,
			Message:   err.Error(),
		}
	}
	if ok {
		return NotificationPermission{
			Authorized: true,
			Available:  true,
			Message:    "Notifications are allowed.",
		}
	}
	return NotificationPermission{
		Authorized: false,
		Available:  true,
		Message:    "Notifications are not allowed yet. Click Enable to request permission.",
	}
}

// RequestNotificationPermission prompts macOS for notification access.
func (s *TransmissionService) RequestNotificationPermission() (NotificationPermission, error) {
	notifier := s.currentNotifier()
	if notifier == nil {
		return NotificationPermission{
			Available: false,
			Message:   "Notification service is not available.",
		}, fmt.Errorf("notification service unavailable")
	}
	ok, err := notifier.RequestNotificationAuthorization()
	if err != nil {
		return NotificationPermission{
			Available: true,
			Message:   err.Error(),
		}, err
	}
	if ok {
		return NotificationPermission{
			Authorized: true,
			Available:  true,
			Message:    "Notifications are allowed.",
		}, nil
	}
	return NotificationPermission{
		Authorized: false,
		Available:  true,
		Message:    "Permission was not granted. You can enable Gearbox in System Settings → Notifications.",
	}, nil
}

// SendTestNotification delivers a sample notification so permission can be verified.
func (s *TransmissionService) SendTestNotification() error {
	perm := s.GetNotificationPermission()
	if !perm.Authorized {
		return fmt.Errorf("notifications are not authorized")
	}
	s.upsertNotification(
		fmt.Sprintf("gearbox-test-%d", time.Now().UnixNano()),
		"Gearbox",
		"Test notification — you’re all set.",
	)
	return nil
}

func (s *TransmissionService) currentNotifier() statusNotifier {
	s.notifyMu.Lock()
	defer s.notifyMu.Unlock()
	return s.notifier
}

// upsertNotification posts or replaces a delivered notification with the same ID.
// On macOS, UNUserNotificationCenter replaces by identifier.
func (s *TransmissionService) upsertNotification(id, title, body string) {
	if notifier := s.currentNotifier(); notifier != nil {
		opts := notifications.NotificationOptions{
			ID:    id,
			Title: title,
			Body:  body,
		}
		if err := notifier.UpdateNotification(opts); err == nil {
			return
		}
		if err := notifier.SendNotification(opts); err == nil {
			return
		}
	}
	script := fmt.Sprintf(
		`display notification %s with title %s`,
		appleScriptString(body),
		appleScriptString(title),
	)
	_ = startNotificationScript(script)
}

func appleScriptString(value string) string {
	out := make([]rune, 0, len(value)+2)
	out = append(out, '"')
	for _, r := range value {
		switch r {
		case '\\', '"':
			out = append(out, '\\', r)
		default:
			out = append(out, r)
		}
	}
	out = append(out, '"')
	return string(out)
}
