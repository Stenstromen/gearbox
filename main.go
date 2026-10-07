//go:build darwin

package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service := NewTransmissionService()
	app := application.New(application.Options{
		Name:        "Gearbox",
		Description: "View a remote Transmission daemon",
		Services: []application.Service{
			application.NewService(service),
		},
		FileAssociations: []string{".torrent"},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	installMenu(app)
	installOpenWith(app, service)

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Gearbox",
		Width:            1080,
		Height:           720,
		MinWidth:         760,
		MinHeight:        480,
		InitialPosition:  application.WindowCentered,
		BackgroundColour: application.NewRGB(18, 19, 22),
		URL:              "/",
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarDefault,
		},
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
