# TURZX bar-screen USB protocol (reverse-engineered)

Device: `USB\VID_1CBE&PID_0092`, product "TURZX1.0", a vendor-class **WinUSB** device (no Zadig
needed — node-usb's libusb opens it directly). Native framebuffer **464×1920** portrait
(`width_real` 464; logical width 480; mounted as a 1920×464 landscape bar). The official app is
a .NET/WPF program ("NUsbMonitorL", a white-label "USB monitor"); this protocol was recovered by
decompiling it (ilspycmd) and confirming with a USBPcap capture + on-hardware tests.

## Transport
- Interface 0, bulk endpoints: **0x01 OUT** (commands + frame bodies), **0x81 IN** (replies), 512-byte packets.
- Every command is a **512-byte packet**: build a 500-byte plaintext
  `[0]=cmdId, [2]=0x1A, [3]=0x6D, [4..7]=LE ms-timestamp, params@8`, **DES-CBC encrypt**
  it (key = IV = ASCII `"slv3tuzx"`), copy the 504-byte ciphertext into a 512-byte buffer and set
  the trailer `buf[510]=0xA1, buf[511]=0x1A`. Write to EP 0x01, then read the reply on EP 0x81.
- For **data** commands the body (image/H.264) is appended **after** the 512-byte encrypted header
  in the same bulk write; `header[8..11]` is the big-endian body length.
- **Replies are plaintext**: `resp[0]` echoes the cmdId, `resp[8..]` is the payload. The device
  sends a 512-byte reply **followed by a zero-length packet (ZLP)** — request >512 bytes on the read
  so libusb absorbs the ZLP, and re-sync by reading until `resp[0]` matches the command you sent
  (otherwise replies drift by one and desync). See `src/turzx.js` `_roundtrip`/`_readIn`.

## Commands (live path)
| cmd | name | notes |
|----|------|------|
| 0x0A | GetVer | reply payload = `"turzx_0001_0015"` |
| 0x6F | StopPlay | stop standalone playback |
| 0x70 | Init | startup |
| 0x0D | (startup) | no param |
| 0x0E | Brightness | `payload[8]` = 0..100 (official used 0x5D=93) |
| 0x34 | BeginSession | `payload[8]=0`, right before first frame |
| 0x33 | EnableMode | `payload[8..14]`=date/time, `payload[15]`=mode (**1=image**, 2=video, 0=stop) |
| 0x66 | SendImage | **PNG** frame body, header[8..11]=BE length (cmd 0x65 = JPEG). The display path. |
| 0x0F | SetFrameRate | `payload[8]` = fps |
| 0x11 | QueryStatus | startup status query |
| 0x7A | StatusPoll | back-pressure poll between frames; `reply[8]` = queue depth |
| 0x79 | SendVideo | H.264 Annex-B frame; ACKed but does **not** display for us — dead end (see below) |

## How display actually works (the key finding)
The panel displays via its **image path**: after the init sequence, send **cmd 0x33 with mode=1**
to enter image mode, then push each frame as a **PNG** via **cmd 0x66** (cmd 0x65 is the JPEG
variant — sending JPEG bytes under cmd 0x66 is silently ignored). Frames are 464×1920 (landscape
content rotated 90°).

Pitfall we hit for a long time: a pure-black first/placeholder image sent via 0x66 **does display**
(black), which looked exactly like a "decode failure / black screen". And the **0x79 H.264 video**
path is ACKed by the device (echoes 0x79, queue drains) but never actually decodes to the panel for
us — so it is a dead end; use the 0x66 image path.

### Startup → stream (what `startImage()` + `play-cat.js` do)
```
GetVer ×2 → StopPlay(0x6F) → Init(0x70) → 0x0D → Brightness(0x0E) → BeginSession(0x34)
→ EnableMode(0x33, mode=1) → first image(0x66 PNG) → SetFrameRate(0x0F) → QueryStatus(0x11)
→ loop:  sendImage(0x66, onePNGframe) ; a couple of 0x7A polls to pace  (≈14–15 fps with ~46 KB PNGs)
```

## Notes / gotchas
- The official app and this program can't both hold the device (WinUSB is exclusive) — close the official app.
- Hard-killing the process mid-transfer can wedge the panel's USB endpoints; the program exits
  cleanly and `open()` does clearHalt + drain, but a physical replug always resets it.
- `des-cbc` is unavailable in Node's OpenSSL 3 by default, so we use a pure-JS DES (`node-forge`).
