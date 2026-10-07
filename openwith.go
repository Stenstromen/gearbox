//go:build darwin

package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const maxTorrentBytes int64 = 8 << 20

func installOpenWith(app *application.App, service *TransmissionService) {
	report := func(err error) {
		if window := app.Window.Current(); window != nil {
			window.UnMinimise()
			window.Show()
			window.Focus()
		}
		if err != nil {
			service.rememberOpenError(err)
			app.Event.Emit("gearbox:open-error", err.Error())
			return
		}
		app.Event.Emit("gearbox:opened")
	}
	app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) {
		if event.Context() == nil {
			return
		}
		path := strings.TrimSpace(event.Context().Filename())
		if path == "" {
			return
		}
		go report(service.openTorrentFile(context.Background(), path))
	})
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) {
		if event.Context() == nil {
			return
		}
		raw := strings.TrimSpace(event.Context().URL())
		if raw == "" {
			return
		}
		go report(service.openMagnet(context.Background(), raw))
	})
}

func (s *TransmissionService) openTorrentFile(ctx context.Context, path string) error {
	request, err := requestFromTorrentFile(path)
	if err != nil {
		return err
	}
	return s.AddTorrent(ctx, request)
}

func (s *TransmissionService) openMagnet(ctx context.Context, raw string) error {
	request, err := requestFromMagnet(raw)
	if err != nil {
		return err
	}
	return s.AddTorrent(ctx, request)
}

func requestFromTorrentFile(path string) (AddTorrentRequest, error) {
	name := filepath.Base(path)
	if !strings.EqualFold(filepath.Ext(path), ".torrent") {
		return AddTorrentRequest{}, fmt.Errorf("%s is not a torrent file", name)
	}
	info, err := os.Stat(path)
	if err != nil {
		return AddTorrentRequest{}, fmt.Errorf("could not read %s", name)
	}
	if info.IsDir() || info.Size() == 0 {
		return AddTorrentRequest{}, fmt.Errorf("%s is not a torrent file", name)
	}
	if info.Size() > maxTorrentBytes {
		return AddTorrentRequest{}, fmt.Errorf("%s is too large to add", name)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return AddTorrentRequest{}, fmt.Errorf("could not read %s", name)
	}
	return AddTorrentRequest{
		Metainfo: []string{base64.StdEncoding.EncodeToString(body)},
		Start:    true,
	}, nil
}

func requestFromMagnet(raw string) (AddTorrentRequest, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(strings.ToLower(raw), "magnet:?") || !validTorrentURL(raw) {
		return AddTorrentRequest{}, fmt.Errorf("not a magnet link")
	}
	return AddTorrentRequest{URL: raw, Start: true}, nil
}
