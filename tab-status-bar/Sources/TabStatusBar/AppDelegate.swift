import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
	private let store = StatusStore()
	private let navigator = WarpNavigator()
	private let menu = NSMenu()
	private var statusItem: NSStatusItem?
	private var refreshTimer: Timer?

	func applicationDidFinishLaunching(_ notification: Notification) {
		let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
		item.button?.title = "TS"
		item.menu = menu
		statusItem = item

		menu.delegate = self
		updateMenu()

		refreshTimer = Timer.scheduledTimer(
			withTimeInterval: 10.0,
			repeats: true,
			block: { [weak self] _ in
				self?.updateMenu()
			}
		)
	}

	func menuWillOpen(_ menu: NSMenu) {
		updateMenu()
	}

	@objc private func focusTab(_ sender: NSMenuItem) {
		guard let entry = sender.representedObject as? TabStatusEntry else {
			return
		}
		let ok = navigator.focusTab(title: entry.title)
		if !ok {
			showAlert("Could not focus Warp tab. Ensure Warp is running and Accessibility access is enabled.")
		}
	}

	@objc private func openStatusFolder() {
		NSWorkspace.shared.open(store.statusDirectory)
	}

	@objc private func refreshMenu() {
		updateMenu()
	}

	@objc private func quitApp() {
		NSApp.terminate(nil)
	}

	private func updateMenu() {
		let entries = store.loadEntries()
		updateStatusTitle(entries)

		menu.removeAllItems()

		if entries.isEmpty {
			let emptyItem = NSMenuItem(title: "No sessions found", action: nil, keyEquivalent: "")
			emptyItem.isEnabled = false
			menu.addItem(emptyItem)
		} else {
			let now = Date()
			for entry in entries {
				let title = menuTitle(for: entry, now: now)
				let item = NSMenuItem(title: title, action: #selector(focusTab(_:)), keyEquivalent: "")
				item.target = self
				item.representedObject = entry
				menu.addItem(item)
			}
		}

		menu.addItem(NSMenuItem.separator())

		let openItem = NSMenuItem(title: "Open status folder", action: #selector(openStatusFolder), keyEquivalent: "")
		openItem.target = self
		menu.addItem(openItem)

		let refreshItem = NSMenuItem(title: "Refresh", action: #selector(refreshMenu), keyEquivalent: "r")
		refreshItem.target = self
		menu.addItem(refreshItem)

		let quitItem = NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q")
		quitItem.target = self
		menu.addItem(quitItem)
	}

	private func updateStatusTitle(_ entries: [TabStatusEntry]) {
		let timeoutCount = entries.filter { $0.state == "timeout" }.count
		let runningCount = entries.filter { $0.state == "running" }.count

		let title: String
		if timeoutCount > 0 {
			title = "TS \(timeoutCount)"
		} else if runningCount > 0 {
			title = "TS *"
		} else {
			title = "TS"
		}

		statusItem?.button?.title = title
	}

	private func menuTitle(for entry: TabStatusEntry, now: Date) -> String {
		let badge = stateBadge(entry.state)
		let baseTitle = entry.title.isEmpty
			? (entry.cwdBase ?? entry.cwd ?? entry.sessionId ?? "Unknown session")
			: entry.title

		let age = ageString(sinceMs: entry.lastActivity, now: now)
		let stale = isStale(entry: entry, now: now)
		var suffixParts: [String] = []
		if !age.isEmpty {
			suffixParts.append(age)
		}
		if stale {
			suffixParts.append("stale")
		}
		let suffix = suffixParts.isEmpty ? "" : " (\(suffixParts.joined(separator: " ")))"
		return "\(badge) \(baseTitle)\(suffix)"
	}

	private func isStale(entry: TabStatusEntry, now: Date) -> Bool {
		let nowMs = now.timeIntervalSince1970 * 1000.0
		return nowMs - entry.lastUpdated > 10 * 60 * 1000
	}

	private func ageString(sinceMs: Double, now: Date) -> String {
		if sinceMs <= 0 {
			return ""
		}
		let seconds = max(0, now.timeIntervalSince1970 - sinceMs / 1000.0)
		if seconds < 60 {
			return "\(Int(seconds))s"
		}
		let minutes = Int(seconds / 60)
		if minutes < 60 {
			return "\(minutes)m"
		}
		let hours = Int(seconds / 3600)
		if hours < 24 {
			return "\(hours)h"
		}
		let days = Int(seconds / 86400)
		return "\(days)d"
	}

	private func stateBadge(_ state: String) -> String {
		switch state {
		case "timeout":
			return "!"
		case "running":
			return ">"
		case "doneNoCommit":
			return "~"
		case "doneCommitted":
			return "."
		case "new":
			return "+"
		default:
			return "?"
		}
	}

	private func showAlert(_ message: String) {
		let alert = NSAlert()
		alert.messageText = "Tab Status"
		alert.informativeText = message
		alert.runModal()
	}
}
