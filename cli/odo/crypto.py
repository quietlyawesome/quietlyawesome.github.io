import base64
import hashlib
import hmac
import json
import os
import re

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

INFO = {
    "wrap": "diary-wrap-v1",
    "token": "diary-token-v1",
    "recovery": "diary-recovery-v1",
    "mac": "diary-mac-v1",
    "object": "diary-object-v1",
    "check": "diary-check-v1",
    "draft": "diary-draft-v1",
}
BUCKETS = (4096, 16384, 65536, 262144)

ZERO_SALT = bytes(32)
B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
PATH_RE = re.compile(r"objects/([0-9a-f]{2})/\1[0-9a-f]{30}\.enc")
B64_RE = re.compile(r"[A-Za-z0-9+/]*={0,2}")


class CryptoError(Exception):
    pass


def _is_v1(x):
    return x == 1 and not isinstance(x, bool)


def random_bytes(n):
    return os.urandom(n)


def b64enc(data):
    return base64.b64encode(data).decode("ascii")


def b64dec(text):
    if not isinstance(text, str) or len(text) % 4 or not B64_RE.fullmatch(text):
        raise CryptoError("bad base64")
    return base64.b64decode(text, validate=True)


def hkdf(ikm, info, salt=ZERO_SALT):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info.encode()).derive(ikm)


def _aes(ikm, info, salt=ZERO_SALT):
    return AESGCM(hkdf(ikm, info, salt))


def passkey_wrap_key(prf):
    return _aes(prf, INFO["wrap"])


def token_key(prf):
    return _aes(prf, INFO["token"])


def recovery_wrap_key(secret, salt):
    return _aes(secret, INFO["recovery"], salt)


def mac_wrap_key(secret):
    return _aes(secret, INFO["mac"])


def object_key(mk):
    return _aes(mk, INFO["object"])


def draft_key(mk):
    return _aes(mk, INFO["draft"])


def _seal(key, iv, data, aad):
    if len(iv) != 12:
        raise CryptoError("bad iv")
    return key.encrypt(iv, bytes(data), aad.encode())


def _open(key, iv, ct, aad):
    if len(iv) != 12:
        raise CryptoError("bad iv")
    try:
        return key.decrypt(iv, ct, aad.encode())
    except InvalidTag:
        raise CryptoError("decrypt failed") from None


def seal_json(key, aad, obj, iv=None):
    iv = iv or random_bytes(12)
    return {"iv": b64enc(iv), "ct": b64enc(_seal(key, iv, _dumps(obj).encode(), aad))}


def open_json(key, aad, box):
    if not isinstance(box, dict):
        raise CryptoError("bad sealed box")
    data = _open(key, b64dec(box.get("iv")), b64dec(box.get("ct")), aad)
    try:
        return json.loads(data.decode("utf-8"))
    except ValueError:
        raise CryptoError("bad sealed box") from None


def new_master_key():
    return random_bytes(32)


def wrap_mk(mk, wrap_key, type_, iv=None):
    if len(mk) != 32:
        raise CryptoError("bad master key")
    iv = iv or random_bytes(12)
    return {"iv": b64enc(iv), "ct": b64enc(_seal(wrap_key, iv, mk, "keyring:" + type_))}


def unwrap_mk(wrap, wrap_key):
    mk = _open(wrap_key, b64dec(wrap.get("iv")), b64dec(wrap.get("ct")), "keyring:" + str(wrap.get("type")))
    if len(mk) != 32:
        raise CryptoError("bad master key")
    return mk


def new_keyring():
    return {"v": 1, "wraps": []}


def passkey_wrap(mk, prf, cred_id, prf_salt, iv=None):
    w = wrap_mk(mk, passkey_wrap_key(prf), "passkey", iv)
    return {"type": "passkey", "credId": b64enc(cred_id), "prfSalt": b64enc(prf_salt), "iv": w["iv"], "ct": w["ct"]}


def recovery_wrap(mk, secret, salt=None, iv=None):
    salt = salt or random_bytes(16)
    w = wrap_mk(mk, recovery_wrap_key(secret, salt), "recovery", iv)
    return {"type": "recovery", "salt": b64enc(salt), "iv": w["iv"], "ct": w["ct"]}


def mac_wrap(mk, secret, iv=None):
    w = wrap_mk(mk, mac_wrap_key(secret), "mac-cli", iv)
    return {"type": "mac-cli", "iv": w["iv"], "ct": w["ct"]}


def _wraps_of(keyring, type_):
    if not isinstance(keyring, dict) or not _is_v1(keyring.get("v")) or not isinstance(keyring.get("wraps"), list):
        raise CryptoError("bad keyring")
    return [w for w in keyring["wraps"] if isinstance(w, dict) and w.get("type") == type_]


def _first_unwrap(wraps, key_for, message):
    for w in wraps:
        try:
            return unwrap_mk(w, key_for(w))
        except CryptoError:
            pass
    raise CryptoError(message)


def unlock_with_passkey(keyring, cred_id, prf):
    cid = b64enc(cred_id)
    wraps = [w for w in _wraps_of(keyring, "passkey") if w.get("credId") == cid]
    return _first_unwrap(wraps, lambda w: passkey_wrap_key(prf), "passkey does not match")


def unlock_with_recovery(keyring, phrase):
    secret = phrase_to_secret(phrase)
    return _first_unwrap(
        _wraps_of(keyring, "recovery"),
        lambda w: recovery_wrap_key(secret, b64dec(w.get("salt"))),
        "recovery phrase does not match",
    )


def unlock_with_mac(keyring, secret):
    return _first_unwrap(_wraps_of(keyring, "mac-cli"), lambda w: mac_wrap_key(secret), "mac key does not match")


def _checksum(secret):
    return hashlib.sha256(secret).digest()[:3]


def secret_to_phrase(secret):
    if len(secret) != 32:
        raise CryptoError("bad recovery secret")
    n = int.from_bytes(secret + _checksum(secret), "big")
    chars = []
    for _ in range(56):
        chars.append(B32[n & 31])
        n >>= 5
    s = "".join(reversed(chars))
    return "-".join(s[i:i + 4] for i in range(0, 56, 4))


def phrase_to_secret(phrase):
    s = re.sub(r"[\s-]", "", str(phrase).upper()).replace("O", "0").replace("I", "1").replace("L", "1")
    if len(s) != 56:
        raise CryptoError("recovery phrase must have 56 characters")
    n = 0
    for c in s:
        i = B32.find(c)
        if i < 0:
            raise CryptoError("recovery phrase has a bad character")
        n = n * 32 + i
    data = n.to_bytes(35, "big")
    secret = data[:32]
    if not hmac.compare_digest(_checksum(secret), data[32:]):
        raise CryptoError("recovery phrase has a typo")
    return secret


def new_recovery():
    secret = random_bytes(32)
    return {"secret": secret, "phrase": secret_to_phrase(secret)}


def padded_size(n):
    need = n + 4
    for b in BUCKETS:
        if need <= b:
            return b
    top = BUCKETS[-1]
    return -(-need // top) * top


def pad(data):
    out = bytearray(padded_size(len(data)))
    out[0:4] = len(data).to_bytes(4, "big")
    out[4:4 + len(data)] = data
    return bytes(out)


def unpad(buf):
    if len(buf) < 4:
        raise CryptoError("bad padding")
    n = int.from_bytes(buf[0:4], "big")
    if n + 4 > len(buf) or padded_size(n) != len(buf):
        raise CryptoError("bad padding")
    if any(buf[4 + n:]):
        raise CryptoError("bad padding")
    return bytes(buf[4:4 + n])


def new_object_path(name=None):
    name = name or random_bytes(16)
    if len(name) != 16:
        raise CryptoError("bad object name")
    h = name.hex()
    return f"objects/{h[:2]}/{h}.enc"


def _check_path(path):
    if not isinstance(path, str) or not PATH_RE.fullmatch(path):
        raise CryptoError("bad object path")


def _dumps(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def encrypt_bytes(key, path, data, iv=None):
    _check_path(path)
    iv = iv or random_bytes(12)
    ct = _seal(key, iv, pad(data), path)
    return _dumps({"v": 1, "alg": "A256GCM", "iv": b64enc(iv), "ct": b64enc(ct)})


def decrypt_bytes(key, path, file):
    _check_path(path)
    try:
        o = json.loads(file)
    except ValueError:
        raise CryptoError("bad object file") from None
    if not isinstance(o, dict) or not _is_v1(o.get("v")) or o.get("alg") != "A256GCM":
        raise CryptoError("bad object file")
    return unpad(_open(key, b64dec(o.get("iv")), b64dec(o.get("ct")), path))


def encrypt_object(key, path, payload, iv=None):
    return encrypt_bytes(key, path, _dumps(payload).encode(), iv)


def decrypt_object(key, path, file):
    data = decrypt_bytes(key, path, file)
    try:
        return json.loads(data.decode("utf-8"))
    except ValueError:
        raise CryptoError("bad object payload") from None
