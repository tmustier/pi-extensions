import Foundation

final class WarpNavigator {
	func focusTab(title: String) -> Bool {
		let safeTitle = escapeAppleScriptString(title)
		let script = """
		on focusWarpTab(targetTitle)
			tell application \"System Events\"
				if not (exists process \"Warp\") then return false
				tell process \"Warp\"
					set frontmost to true
					repeat with w in windows
						set startTitle to name of w
						perform action \"AXRaise\" of w
						delay 0.05
						if name of w contains targetTitle then return true
						repeat
							click menu item \"Switch to Next Tab\" of menu 1 of menu bar item \"Tab\" of menu bar 1
							delay 0.05
							if name of w contains targetTitle then return true
							if name of w is startTitle then exit repeat
						end repeat
					end repeat
				end tell
			end tell
			return false
		end focusWarpTab

		focusWarpTab(\"\(safeTitle)\")
		"""

		var errorInfo: NSDictionary?
		guard let appleScript = NSAppleScript(source: script) else {
			return false
		}
		let result = appleScript.executeAndReturnError(&errorInfo)
		if errorInfo != nil {
			return false
		}
		return result.booleanValue
	}

	private func escapeAppleScriptString(_ value: String) -> String {
		return value
			.replacingOccurrences(of: "\\", with: "\\\\")
			.replacingOccurrences(of: "\"", with: "\\\"")
	}
}
