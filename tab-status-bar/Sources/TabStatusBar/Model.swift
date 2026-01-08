import Foundation

struct TabStatusEntry: Codable {
	let version: Int?
	let pid: Int
	let sessionFile: String?
	let sessionId: String?
	let cwd: String?
	let cwdBase: String?
	let title: String
	let state: String
	let running: Bool?
	let sawCommit: Bool?
	let lastActivity: Double
	let lastUpdated: Double
	let hasUI: Bool?
}
