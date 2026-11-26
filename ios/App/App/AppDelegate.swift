import UIKit
import Capacitor
import Foundation
import StoreKit
import AVFoundation

/* SHOOTOUT 4 — the iOS app entry point (Build 1).
 *
 * `npx cap add ios` が作る AppDelegate を置き換える。中身は3つ:
 *
 *   1. アプリのデリゲート（テンプレートそのまま）
 *   2. ShootoutBridgeViewController — このアプリが実際に動かす Capacitor の
 *      ビューコントローラ。StoreKit のプラグインをブリッジに自分で渡す
 *   3. PRO の StoreKit 2 プラグイン
 *
 * プラグインを `cap sync` の packageClassList に任せず、ここで登録する理由:
 * そのリストは実行時に NSClassFromString で解決され、端末で見つからないと
 * 課金画面まで来ても StoreKit に届かず、購入が必ず失敗する。ここで
 * インスタンスを作れば、クラスが無いことはビルドエラーになる（CODE DUEL /
 * ICE WOLF と同じ方式で、実際に購入できる形）。
 */

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Build 2 / Build 3: アプリ側の Audio Session を .playback で起こしておく。
        // これだけで WKWebView の Web Audio が鳴るわけではない（WebView は別プロセスで
        // 独自の Audio Session を持つ）。Web Audio 側は www/src/audio.js が
        // navigator.audioSession.type = 'playback' と無音の <audio> で切り替える。
        // ここは、アプリの音とほかのアプリの音が混ざるようにするための設定。
        AppDelegate.activateAudioSession()
        return true
    }

    /// アプリ側の AVAudioSession を playback で起こし直す。
    /// 電話・Siri・バックグラウンドから戻ると、セッションが止まっていることがある。
    static func activateAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            // 音が出せなくてもゲームは続けられる（落とさない）
            NSLog("SHOOTOUT 4: AVAudioSession setup failed: \(error)")
        }
    }

    /// Build 3: アプリを離れるときは Audio Session を手放す。
    /// これをしないと、ホーム画面へ戻っても Dynamic Island のスピーカー印と
    /// 音が残り続けた（他のアプリの音も鳴らせない）。
    static func deactivateAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            NSLog("SHOOTOUT 4: AVAudioSession deactivate failed: \(error)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Build 3: ホームボタン・他アプリ・電話などで前面から外れる直前に音を止める
        AppDelegate.deactivateAudioSession()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Build 3: バックグラウンドへ入ったら、念のためもう一度手放す
        AppDelegate.deactivateAudioSession()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Build 3: 戻ってきたら Audio Session を起こし直す（音が戻らない問題の対策）
        AppDelegate.activateAudioSession()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

/// このアプリのブリッジ。SceneDelegate がこれを root にする。
/// `capacitorDidLoad()` は WebView が最初のページを読む前に走るので、
/// ここでプラグインを渡せば www/pro.js が最初の1回から StoreKit を見つけられる。
final class ShootoutBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StoreKitPlugin())
        bridge?.registerPluginInstance(ShootoutAudioPlugin())
    }
}

/* Build 3: 音のための小さなブリッジ。

   WKWebView の Web Audio は別プロセスの Audio Session で鳴るので、アプリ側の
   AVAudioSession を設定するだけでは足りない。それでも「操作のたびにアプリ側の
   セッションを起こし直す」ことで、ほかのアプリの音と混ざる状態を保てる。
   www/src/audio.js の unlock() が、Capacitor があるときだけ activate を呼ぶ。 */
@objc(ShootoutAudioPlugin)
public class ShootoutAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShootoutAudioPlugin"
    public let jsName = "ShootoutAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivate", returnType: CAPPluginReturnPromise)
    ]

    @objc public func activate(_ call: CAPPluginCall) {
        AppDelegate.activateAudioSession()
        let session = AVAudioSession.sharedInstance()
        call.resolve([
            "category": session.category.rawValue,
            "active": session.isOtherAudioPlaying
        ])
    }

    /// アプリを離れるときに Web 側からも呼べる（Dynamic Island のスピーカー印を消す）
    @objc public func deactivate(_ call: CAPPluginCall) {
        AppDelegate.deactivateAudioSession()
        call.resolve(["active": false])
    }
}

/* SHOOTOUT 4 PRO（世界挑戦パス）の StoreKit 2 ブリッジ。
   非消耗型の1アイテム。ここは Apple が言ったことだけを返す。
   画面の判断は www/pro.js が持つ。

   失敗には必ず短い `SK: …` の理由を付ける（PRO シートが小さく表示する）:
     getProducts  → 商品が空なら `diag: "SK: empty"`（App Store Connect に商品が無い）
     purchase     → `SK: empty <id>`、または Apple のエラー文
     restore      → AppStore.sync() のエラー（購入済みなら entitled が正） */
@objc(StoreKitPlugin)
public class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "StoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entitlement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    static let defaultProductId = "jp.signlink.Shootout4.pro"

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        guard #available(iOS 15.0, *) else { return }
        /* ほかの端末からの購入や、途中で止まった購入がここに来る。
           アプリは自分の権利を自分で読むので、Web 側へは何も押し込まない。 */
        updatesTask = Task.detached {
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    private func productId(_ call: CAPPluginCall) -> String {
        let value = call.getString("id") ?? StoreKitPlugin.defaultProductId
        return value.isEmpty ? StoreKitPlugin.defaultProductId : value
    }

    private static func reason(_ error: Error) -> String {
        let text = error.localizedDescription.replacingOccurrences(of: "\n", with: " ")
        return text.isEmpty ? "unknown error" : text
    }

    @objc public func getProducts(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("SK: needs iOS 15", "SK_IOS", nil)
            return
        }
        let ids = call.getArray("ids", String.self) ?? [StoreKitPlugin.defaultProductId]
        Task {
            do {
                let products = try await Product.products(for: ids)
                let list: [[String: Any]] = products.map { product in
                    [
                        "id": product.id,
                        "displayName": product.displayName,
                        "description": product.description,
                        "displayPrice": product.displayPrice,
                        "price": "\(product.price)",
                        "currencyCode": product.priceFormatStyle.currencyCode
                    ]
                }
                var answer: [String: Any] = ["products": list, "ids": ids]
                if list.isEmpty {
                    /* 静かに失敗して「動く店」に見えていた経路を、ここで名指しする。
                       長い文は意図的: 短い Swift リテラルは機械語に詰め込まれて
                       `strings` に出ないため、CI はこの行で診断が入ったことを確かめる。 */
                    answer["diag"] = "SK: empty"
                    answer["message"] = "SK: empty — App Store returned no product for \(ids.joined(separator: ", ")). The product must exist in App Store Connect as 提出準備完了 and the paid apps agreement must be active."
                }
                call.resolve(answer)
            } catch {
                call.reject("SK: \(StoreKitPlugin.reason(error))", "SK_ERROR", error)
            }
        }
    }

    @objc public func entitlement(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["entitled": false, "diag": "SK: needs iOS 15"])
            return
        }
        let id = productId(call)
        Task {
            let owned = await StoreKitPlugin.owns(id)
            call.resolve(["entitled": owned])
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("SK: needs iOS 15", "SK_IOS", nil)
            return
        }
        let id = productId(call)
        Task { @MainActor in
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("SK: empty \(id)", "SK_EMPTY", nil)
                    return
                }
                switch try await product.purchase() {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        await transaction.finish()
                        call.resolve([
                            "status": "success",
                            "entitled": true,
                            "transactionId": String(transaction.id)
                        ])
                    case .unverified:
                        call.resolve([
                            "status": "failed",
                            "entitled": false,
                            "reason": "unverified",
                            "diag": "SK: unverified"
                        ])
                    }
                case .pending:
                    call.resolve(["status": "pending", "entitled": false])
                case .userCancelled:
                    call.resolve(["status": "cancelled", "entitled": false])
                @unknown default:
                    call.resolve([
                        "status": "failed",
                        "entitled": false,
                        "reason": "unknown",
                        "diag": "SK: unknown purchase result"
                    ])
                }
            } catch {
                call.reject("SK: \(StoreKitPlugin.reason(error))", "SK_ERROR", error)
            }
        }
    }

    @objc public func restore(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["entitled": false, "diag": "SK: needs iOS 15"])
            return
        }
        let id = productId(call)
        Task {
            var syncError: String?
            do {
                try await AppStore.sync()
            } catch {
                /* サインインのシートを閉じても、下の確認はこの端末の知識で答える */
                syncError = "SK: \(StoreKitPlugin.reason(error))"
            }
            let owned = await StoreKitPlugin.owns(id)
            var answer: [String: Any] = ["entitled": owned]
            if let syncError = syncError, !owned {
                answer["diag"] = syncError
            }
            call.resolve(answer)
        }
    }

    /// 検証済みで、取り消されていない購入だけ true
    static func owns(_ productID: String) async -> Bool {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.productID == productID && transaction.revocationDate == nil {
                return true
            }
        }
        return false
    }
}
