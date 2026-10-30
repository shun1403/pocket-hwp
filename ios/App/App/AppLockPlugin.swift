import Capacitor
import LocalAuthentication
import UIKit

/// 앱 잠금: 기기 잠금(Face ID·Touch ID·기기 암호)으로 확인하고, 앱 전환 화면에서 앱 내용을 가린다.
///
/// available: 기기 잠금으로 확인할 수 있는가
/// authenticate: 확인 창을 띄운다. 성공하면 ok=true (취소·실패는 ok=false)
/// setSecure: 앱 전환 화면에서 가릴지 저장한다 (SceneDelegate가 화면을 덮는다)
@objc(AppLockPlugin)
public class AppLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppLockPlugin"
    public let jsName = "AppLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecure", returnType: CAPPluginReturnPromise),
    ]

    /// SceneDelegate가 읽는 설정 열쇠
    static let hideKey = "pocketHwpHideInSwitcher"

    @objc func available(_ call: CAPPluginCall) {
        var error: NSError?
        let ok = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        call.resolve(["available": ok])
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Pocket HWP"
        LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            call.resolve(["ok": ok, "error": error?.localizedDescription ?? ""])
        }
    }

    @objc func setSecure(_ call: CAPPluginCall) {
        UserDefaults.standard.set(call.getBool("on") ?? false, forKey: AppLockPlugin.hideKey)
        call.resolve()
    }
}
