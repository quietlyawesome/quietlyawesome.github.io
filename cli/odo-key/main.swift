import Foundation
import LocalAuthentication
import Security

let service = "io.github.quietlyawesome.odometer"
let account = "mac-cli"

func fail(_ message: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data(("odo-key: " + message + "\n").utf8))
    exit(code)
}

final class Outcome: @unchecked Sendable {
    var ok = false
    var error: Error?
}

func authenticate(_ reason: String) {
    let context = LAContext()
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
        fail("cannot authenticate: \(error?.localizedDescription ?? "unknown")", 3)
    }
    let outcome = Outcome()
    let done = DispatchSemaphore(value: 0)
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
        outcome.ok = ok
        outcome.error = err
        done.signal()
    }
    done.wait()
    if !outcome.ok { fail(outcome.error?.localizedDescription ?? "authentication failed", 2) }
}

func baseQuery() -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecUseDataProtectionKeychain as String: false,
    ]
}

func exists() -> Bool {
    var q = baseQuery()
    q[kSecReturnAttributes as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    return SecItemCopyMatching(q as CFDictionary, nil) == errSecSuccess
}

func onlyMeAccess() -> SecAccess {
    var me: SecTrustedApplication?
    guard SecTrustedApplicationCreateFromPath(nil, &me) == errSecSuccess, let app = me else { fail("cannot build keychain ACL") }
    var access: SecAccess?
    guard SecAccessCreate("Odometer key" as CFString, [app] as CFArray, &access) == errSecSuccess, let a = access else { fail("cannot build keychain ACL") }
    return a
}

func store(replace: Bool) {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let text = String(decoding: input, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let secret = Data(base64Encoded: text), secret.count == 32 else { fail("expected 32 bytes, base64, on stdin") }
    if exists() && !replace { fail("a key already exists (use --replace)") }
    authenticate("save the Odometer key on this Mac")
    if exists() { SecItemDelete(baseQuery() as CFDictionary) }
    var q = baseQuery()
    q[kSecValueData as String] = secret
    q[kSecAttrLabel as String] = "Odometer (odo)"
    q[kSecAttrAccess as String] = onlyMeAccess()
    let status = SecItemAdd(q as CFDictionary, nil)
    if status != errSecSuccess { fail("keychain write failed (\(status))") }
}

func read() {
    if !exists() { fail("no key on this Mac (run: odo init)", 4) }
    authenticate("unlock Odometer")
    var q = baseQuery()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    guard status == errSecSuccess, let data = out as? Data, data.count == 32 else { fail("keychain read failed (\(status))") }
    FileHandle.standardOutput.write(Data((data.base64EncodedString() + "\n").utf8))
}

func delete() {
    if !exists() { return }
    authenticate("remove the Odometer key from this Mac")
    let status = SecItemDelete(baseQuery() as CFDictionary)
    if status != errSecSuccess { fail("keychain delete failed (\(status))") }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "store": store(replace: args.contains("--replace"))
case "read": read()
case "delete": delete()
case "status": print(exists() ? "present" : "absent")
default: fail("usage: odo-key store [--replace] | read | delete | status", 64)
}
