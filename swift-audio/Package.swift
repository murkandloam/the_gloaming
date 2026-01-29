// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "GloamingAudio",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "gloaming-audio",
            path: "Sources/GloamingAudio"
        )
    ]
)
