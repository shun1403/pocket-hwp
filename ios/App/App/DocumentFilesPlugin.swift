import Capacitor
import UIKit
import UniformTypeIdentifiers

/// 앱 안에 들어 있는 플러그인을 등록하는 화면 (SceneDelegate가 루트로 쓴다).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DocumentFilesPlugin())
    }
}

/// 원래 파일 자리에 다시 저장하기 위한 문서 열기·쓰기.
///
/// open: 문서 선택기로 파일을 "제자리에서" 열고(복사하지 않음) 보안 북마크를 돌려준다.
/// write: 그 북마크로 같은 파일에 덮어쓴다. 파일 앱·iCloud Drive·다른 저장소 앱 모두 같은 방식이다.
/// print: 웹 코드가 만든 PDF를 iOS 인쇄 화면에 넘긴다.
@objc(DocumentFilesPlugin)
public class DocumentFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "DocumentFilesPlugin"
    public let jsName = "DocumentFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
    ]

    private static let maxBytes = 200 * 1024 * 1024
    private var pendingCall: CAPPluginCall?

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let types: [UTType] = [
                UTType(importedAs: "com.hancom.hwp"),
                UTType(importedAs: "com.hancom.hwpx"),
                UTType.data,
            ]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pendingCall?.resolve(["cancelled": true])
            self.pendingCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.resolve(["cancelled": true])
        pendingCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let url = urls.first else {
            call.resolve(["cancelled": true])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let accessing = url.startAccessingSecurityScopedResource()
            defer {
                if accessing { url.stopAccessingSecurityScopedResource() }
            }
            do {
                let data = try Self.coordinatedRead(url)
                if data.count > Self.maxBytes {
                    call.reject("문서가 너무 커요.", "TOO_LARGE")
                    return
                }
                let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
                call.resolve([
                    "uri": bookmark.base64EncodedString(),
                    "name": url.lastPathComponent,
                    "data": data.base64EncodedString(),
                    "writable": true,
                ])
            } catch {
                call.reject("문서를 읽지 못했어요.", "READ_FAILED", error)
            }
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let bookmark = Data(base64Encoded: uri),
              let text = call.getString("data"), let data = Data(base64Encoded: text)
        else {
            call.reject("uri, data 가 필요해요.", "BAD_REQUEST")
            return
        }
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            let accessing = url.startAccessingSecurityScopedResource()
            defer {
                if accessing { url.stopAccessingSecurityScopedResource() }
            }
            try Self.coordinatedWrite(data, to: url)
            var result: [String: Any] = [:]
            // 파일이 옮겨져 북마크가 낡았으면 새 북마크를 돌려준다.
            if stale {
                result["uri"] = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil).base64EncodedString()
            }
            call.resolve(result)
        } catch {
            call.reject("원래 파일에 저장하지 못했어요.", "WRITE_FAILED", error)
        }
    }

    @objc func print(_ call: CAPPluginCall) {
        guard let text = call.getString("data"), let data = Data(base64Encoded: text) else {
            call.reject("data 가 필요해요.", "BAD_REQUEST")
            return
        }
        let name = call.getString("name") ?? "문서"
        DispatchQueue.main.async {
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = name
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printingItem = data
            controller.present(animated: true) { _, _, error in
                if let error = error {
                    call.reject("인쇄하지 못했어요.", "PRINT_FAILED", error)
                } else {
                    call.resolve()
                }
            }
        }
    }

    private static func coordinatedRead(_ url: URL) throws -> Data {
        var coordinatorError: NSError?
        var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
            result = Result { try Data(contentsOf: readURL) }
        }
        if let error = coordinatorError { throw error }
        return try result.get()
    }

    private static func coordinatedWrite(_ data: Data, to url: URL) throws {
        var coordinatorError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinatorError) { writeURL in
            do {
                try data.write(to: writeURL)
            } catch {
                writeError = error
            }
        }
        if let error = coordinatorError ?? writeError { throw error }
    }
}
