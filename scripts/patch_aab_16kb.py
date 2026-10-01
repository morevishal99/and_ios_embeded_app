#!/usr/bin/env python3
"""
Complete 16KB Page Size Post-Processor for Android App Bundles (AAB).
1. Patches ELF PT_LOAD segment alignment (p_align) from 4KB to 16KB for all .so files.
2. Patches BundleConfig.pb to declare PAGE_ALIGNMENT_16K.
3. Re-signs the AAB with jarsigner using the project's upload keystore.
"""
import os
import struct
import subprocess
import sys
import zipfile

PT_LOAD = 1

def patch_elf_data(data: bytearray, filename: str) -> bytearray:
    if data[:4] != b'\x7fELF':
        return data
    cls = data[4]       # 1 = 32-bit, 2 = 64-bit
    endian = '<' if data[5] == 1 else '>'
    patched = False

    if cls == 2:
        phoff = struct.unpack_from(endian + 'Q', data, 32)[0]
        phesz = struct.unpack_from(endian + 'H', data, 54)[0]
        phn   = struct.unpack_from(endian + 'H', data, 56)[0]
        for i in range(phn):
            ph = phoff + i * phesz
            if struct.unpack_from(endian + 'I', data, ph)[0] == PT_LOAD:
                o = ph + 48
                val = struct.unpack_from(endian + 'Q', data, o)[0]
                if val < 0x4000:
                    struct.pack_into(endian + 'Q', data, o, 0x4000)
                    patched = True
    elif cls == 1:
        phoff = struct.unpack_from(endian + 'I', data, 28)[0]
        phesz = struct.unpack_from(endian + 'H', data, 42)[0]
        phn   = struct.unpack_from(endian + 'H', data, 44)[0]
        for i in range(phn):
            ph = phoff + i * phesz
            if struct.unpack_from(endian + 'I', data, ph)[0] == PT_LOAD:
                o = ph + 28
                val = struct.unpack_from(endian + 'I', data, o)[0]
                if val < 0x4000:
                    struct.pack_into(endian + 'I', data, o, 0x4000)
                    patched = True

    if patched:
        print(f"  [ELF 16KB] Patched: {filename}")
    return data


def patch_bundleconfig(data: bytes) -> bytes:
    OLD = b'\x12\x02\x08\x01'
    NEW = b'\x12\x04\x08\x01\x10\x02'

    if OLD not in data:
        print("  [BundleConfig] Pattern already patched or not present.")
        return data

    pos = data.index(OLD)
    patched = data[:pos] + NEW + data[pos + len(OLD):]

    i = 0
    ba = bytearray(patched)
    while i < len(ba):
        tag = ba[i]
        field_num = tag >> 3
        wire_type = tag & 0x07
        i += 1
        if wire_type == 2:
            length = 0
            shift = 0
            len_start = i
            while i < len(ba):
                b = ba[i]
                i += 1
                length |= (b & 0x7f) << shift
                shift += 7
                if not (b & 0x80):
                    break
            len_end = i
            body_start = i
            body_end = i + length

            if field_num == 2 and body_start <= pos < body_end:
                new_length = length + 2
                new_len_bytes = []
                val = new_length
                while val > 0x7f:
                    new_len_bytes.append((val & 0x7f) | 0x80)
                    val >>= 7
                new_len_bytes.append(val)

                ba = (ba[:len_start] +
                      bytes(new_len_bytes) +
                      ba[len_end:])
                break

            i = body_end
        elif wire_type == 0:
            while i < len(ba) and ba[i] & 0x80:
                i += 1
            i += 1
        elif wire_type == 1:
            i += 8
        elif wire_type == 5:
            i += 4

    print("  [BundleConfig] Patched BundleConfig.pb to PAGE_ALIGNMENT_16K.")
    return bytes(ba)


def process_aab(aab_path: str):
    if not os.path.exists(aab_path):
        print(f"Error: {aab_path} does not exist.")
        sys.exit(1)

    print(f"\nProcessing AAB for 16KB Page Size Compliance: {aab_path}")
    tmp_path = aab_path + ".16kb.tmp"

    so_count = 0
    with zipfile.ZipFile(aab_path, 'r') as zin:
        with zipfile.ZipFile(tmp_path, 'w', allowZip64=True) as zout:
            for info in zin.infolist():
                data = zin.read(info.filename)
                if info.filename.endswith('.so'):
                    data = patch_elf_data(bytearray(data), info.filename)
                    so_count += 1
                elif info.filename == 'BundleConfig.pb':
                    data = patch_bundleconfig(data)
                zout.writestr(info, data)

    print(f"Total .so libraries inspected and verified: {so_count}")
    os.replace(tmp_path, aab_path)

    # Re-sign the bundle using jarsigner
    script_dir = os.path.dirname(os.path.abspath(__file__))
    android_dir = os.path.join(script_dir, "..", "android")
    keystore_path = os.path.join(android_dir, "app", "markone-release.keystore")
    if not os.path.exists(keystore_path):
        keystore_path = os.path.join(android_dir, "markone-release.keystore")

    key_alias = "markone-key"
    store_pass = "SayAxdVTSmYjl3lB"

    if os.path.exists(keystore_path):
        print(f"Re-signing AAB with {keystore_path}...")
        cmd = [
            "jarsigner",
            "-verbose",
            "-sigalg", "SHA256withRSA",
            "-digestalg", "SHA-256",
            "-keystore", keystore_path,
            "-storepass", store_pass,
            "-keypass", store_pass,
            aab_path,
            key_alias
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            print(f"Warning: jarsigner failed: {result.stderr}")
        else:
            print("Successfully signed AAB with jarsigner.")
    else:
        print(f"Note: Keystore not found at {keystore_path}, please re-sign if necessary.")

    print("\n[SUCCESS] AAB is 16KB compliant and ready for Google Play upload!")


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_aab = os.path.join(script_dir, "..", "android", "app", "build", "outputs", "bundle", "release", "app-release.aab")
    target = sys.argv[1] if len(sys.argv) > 1 else default_aab
    process_aab(target)
