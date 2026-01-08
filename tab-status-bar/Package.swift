// swift-tools-version: 5.9
import PackageDescription

let package = Package(
	name: "tab-status-bar",
	platforms: [
		.macOS(.v13)
	],
	products: [
		.executable(name: "tab-status-bar", targets: ["TabStatusBar"])
	],
	targets: [
		.executableTarget(
			name: "TabStatusBar"
		)
	]
)
