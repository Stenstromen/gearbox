//go:build darwin

package main

import "github.com/wailsapp/wails/v3/pkg/application"

const (
	eventPreferences = "gearbox:preferences"
	eventAdd         = "gearbox:add"
	eventRemove      = "gearbox:remove"
	eventStart       = "gearbox:start"
	eventStop        = "gearbox:stop"
	eventSelectAll   = "gearbox:select-all"
	eventDeselect    = "gearbox:deselect"
	eventInspector   = "gearbox:inspector"
	eventRefresh     = "gearbox:refresh"
)

func installMenu(app *application.App) {
	app.Menu.Set(application.NewMenuFromItems(
		application.NewSubmenu("Gearbox", appMenu(app)),
		application.NewSubmenu("File", fileMenu(app)),
		application.NewSubmenu("Edit", editMenu(app)),
		application.NewSubmenu("View", viewMenu(app)),
		application.NewSubmenu("Window", windowMenu()),
	))
}

func appMenu(app *application.App) *application.Menu {
	menu := application.NewMenu()
	menu.AddRole(application.About)
	menu.AddSeparator()
	menu.Add("Preferences…").
		SetAccelerator("CmdOrCtrl+,").
		OnClick(emit(app, eventPreferences))
	menu.AddSeparator()
	menu.AddRole(application.ServicesMenu)
	menu.AddSeparator()
	menu.AddRole(application.Hide)
	menu.AddRole(application.HideOthers)
	menu.AddRole(application.UnHide)
	menu.AddSeparator()
	menu.AddRole(application.Quit)
	return menu
}

func fileMenu(app *application.App) *application.Menu {
	menu := application.NewMenu()
	menu.Add("Add Torrents…").
		SetAccelerator("CmdOrCtrl+o").
		OnClick(emit(app, eventAdd))
	menu.Add("Remove Selected…").
		OnClick(emit(app, eventRemove))
	menu.AddSeparator()
	menu.Add("Start Selected").
		SetTooltip("Keyboard shortcut: R").
		OnClick(emit(app, eventStart))
	menu.Add("Stop Selected").
		SetTooltip("Keyboard shortcut: U").
		OnClick(emit(app, eventStop))
	menu.AddSeparator()
	menu.AddRole(application.CloseWindow)
	return menu
}

func editMenu(app *application.App) *application.Menu {
	menu := application.NewMenu()
	menu.AddRole(application.Undo)
	menu.AddRole(application.Redo)
	menu.AddSeparator()
	menu.AddRole(application.Cut)
	menu.AddRole(application.Copy)
	menu.AddRole(application.Paste)
	menu.AddRole(application.PasteAndMatchStyle)
	menu.AddRole(application.Delete)
	menu.AddRole(application.SelectAll)
	menu.AddSeparator()
	menu.Add("Select All Torrents").
		SetAccelerator("CmdOrCtrl+Shift+a").
		OnClick(emit(app, eventSelectAll))
	menu.Add("Deselect All").
		SetAccelerator("CmdOrCtrl+Shift+d").
		OnClick(emit(app, eventDeselect))
	return menu
}

func viewMenu(app *application.App) *application.Menu {
	menu := application.NewMenu()
	menu.Add("Inspector").
		SetAccelerator("CmdOrCtrl+i").
		OnClick(emit(app, eventInspector))
	menu.Add("Refresh").
		SetAccelerator("CmdOrCtrl+r").
		OnClick(emit(app, eventRefresh))
	menu.AddSeparator()
	menu.AddRole(application.ToggleFullscreen)
	return menu
}

func windowMenu() *application.Menu {
	menu := application.NewMenu()
	menu.AddRole(application.Minimise)
	menu.AddRole(application.Zoom)
	menu.AddSeparator()
	menu.AddRole(application.Front)
	return menu
}

func emit(app *application.App, name string) func(*application.Context) {
	return func(*application.Context) {
		app.Event.Emit(name)
	}
}
