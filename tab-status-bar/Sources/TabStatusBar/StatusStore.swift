import Foundation

final class StatusStore {
	let statusDirectory: URL

	init(statusDirectory: URL = StatusStore.defaultStatusDirectory()) {
		self.statusDirectory = statusDirectory
	}

	func loadEntries() -> [TabStatusEntry] {
		let files: [URL]
		do {
			files = try FileManager.default.contentsOfDirectory(
				at: statusDirectory,
				includingPropertiesForKeys: nil,
				options: [.skipsHiddenFiles]
			)
		} catch {
			return []
		}

		let decoder = JSONDecoder()
		var entries: [TabStatusEntry] = []
		for file in files {
			guard file.pathExtension == "json" else { continue }
			guard let data = try? Data(contentsOf: file) else { continue }
			guard let entry = try? decoder.decode(TabStatusEntry.self, from: data) else { continue }
			entries.append(entry)
		}

		return entries.sorted { left, right in
			let leftRank = stateRank(left.state)
			let rightRank = stateRank(right.state)
			if leftRank != rightRank {
				return leftRank < rightRank
			}
			return left.lastActivity > right.lastActivity
		}
	}

	static func defaultStatusDirectory() -> URL {
		return FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent(".pi")
			.appendingPathComponent("agent")
			.appendingPathComponent("tab-status")
	}

	private func stateRank(_ state: String) -> Int {
		switch state {
		case "timeout":
			return 0
		case "running":
			return 1
		case "doneNoCommit":
			return 2
		case "doneCommitted":
			return 3
		case "new":
			return 4
		default:
			return 5
		}
	}
}
