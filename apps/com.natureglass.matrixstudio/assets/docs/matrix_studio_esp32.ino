/*
 * MATRIX STUDIO — ESP32 firmware v2.2  (one binary for ESP32-C6 and classic ESP32-WROOM-32)
 * Pair with Matrix_Studio.html (protocol v2) or simple_serial_panel.html v17 (diagnostic page).
 *
 * BASE: simple_serial_panel.ino v15 — the streaming transport that was debugged on
 * hardware. Matrix Studio's app features are ported ONTO that base. The transport + LED
 * driver are unchanged except for two things:
 *   (1) a type byte in the packet header so CONFIG and FRAME coexist on the wire;
 *   (2) pin / LED count / brightness are runtime values (NVS-backed) instead of #defines.
 *
 * Transport is USB/serial only (native USB CDC, or a UART bridge).
 *
 * Protocol v2.1 (little-endian byte stream):
 *   A5 5A | type | seq | len_lo len_hi | payload[len] | sum_lo sum_hi
 *   type 0x01 FRAME   len = ledCount*3 (strict)   payload = R G B per LED, physical strip order
 *   type 0x02 CONFIG  len = 4                     payload = [pin][count_lo][count_hi][brightness]
 *   type 0x03 DELTA   len = 5*n (n>=1)            payload = n * [idx_lo idx_hi R G B], physical idx
 *   sum  = (type + seq + len_lo + len_hi + sum(payload)) mod 65536
 *   seq  = one 8-bit counter on the sender, +1 per packet of ANY type.
 *   Per-frame "OK <seq>\n" acks are OFF by default (ACK_AFTER_SHOW=0) — free-running USB ignores
 *   them and each one costs a host read-URB per frame (see the define). CONFIG still answers
 *   "CFG pin=.. count=.. bri=.. mem=.. delta=1\n" with the values actually in effect
 *   (delta=1 advertises DELTA support so an older app can stay on full FRAMEs).
 *   A packet whose type is unknown, whose len is invalid, or whose checksum fails is
 *   dropped and the parser re-syncs on the next A5 5A. No recovery pass (measured worse).
 *
 * DELTA encoding (added v2.3): FRAME writes the persistent framebuffer `frameBuf` and shows
 * it; DELTA patches only the changed pixels of `frameBuf` and shows it. The whole strip is
 * still re-transmitted every show (WS2812 can't be partially updated) — DELTA only shrinks
 * the USB bytes/frame, which is what lets the C6's USB-Serial/JTAG sustain 60 fps for sparse
 * content. The sender emits periodic full FRAMEs (keyframes) so a dropped DELTA self-heals.
 *
 * Things deliberately NOT in this file — do not re-add them:
 *   - Adafruit_NeoPixel for the strip: blocking show() starves IDLE -> task WDT.
 *   - Manual resync/rescan passes in the parser.
 *
 * Transport design:
 *   - USB/serial: bytes are read in loop() and fed to parser rxUsb.
 *     ledShow() is ONLY ever called from loop().
 *   - Raw RMT TX at interrupt priority 3. ledShow() is non-blocking: it waits for the
 *     PREVIOUS frame's transfer at entry, starts this one and returns, so the loop task
 *     keeps yielding.
 *   - loop() feeds the task WDT and delay(1)s so the IDLE task runs.
 *
 * One binary, no board #define:
 *   - RMT memory: the WS2812 channel auto-sizes its RMT block via a fallback ladder —
 *     96 symbols on the C6 (2x48), 64 on the classic ESP32 (1x64) — because the driver
 *     requires a multiple of the per-chip block size and no single value fits both.
 *   - No onboard status LED: the classic ESP32-WROOM devkit has no addressable LED, and
 *     its GPIO 8 is a SPI-flash pin, so the status indicator was dropped for portability.
 *
 * Runtime pin rules (portable): the strip data pin must be 0-5 or 14-23. GPIO 6-11 are
 * SPI flash on the classic ESP32; 12/13 are USB D-/D+ on the C6 and flash-voltage
 * strapping on the ESP32; 24+ are flash / not bonded out. A CONFIG with an unusable pin
 * keeps the current pin and says so in the CFG line.
 */
#define FW_VERSION            "2.4"
#define LED_PIN_DEFAULT       4       // shared-safe on C6 + classic ESP32 (app CONFIG overrides it)
#define LED_COUNT_DEFAULT     512
#define BRIGHTNESS_DEFAULT    40      // Adafruit scale: out = (c * (b+1)) >> 8
#define MAX_LEDS              1024
#define SERIAL_BAUD           921600  // irrelevant on native USB CDC, matters on a UART bridge
#define RX_BUFFER_BYTES       8192
#define NVS_NAMESPACE         "matrix2"   // v1 used "matrix"; new namespace so a stale pin=5 never loads
#define ACK_AFTER_SHOW        0       // v2.4: OFF. On free-running USB the app ignores "OK <seq>",
                                       // but every ack it sends forces a host read-URB (buffer +
                                       // usb:hs DMA map) per frame — at 60 fps that DOUBLES the URB
                                       // rate and is what tips the C6's USB-Serial/JTAG over. The
                                       // link needs no per-frame device->host traffic; CFG/BOOT/
                                       // RMTERR still report state. Set to 1 only for diagnostics.
#define DEBUG_STATS           0       // 1 = STAT lines every second + BLW write trace + BAD/BADLEN lines
#define STATS_MS              1000

#define PKT_FRAME             0x01
#define PKT_CONFIG            0x02
#define PKT_DELTA             0x03
#define CONFIG_LEN            4
#define DELTA_ENTRY           5       // idx_lo idx_hi R G B

#include <stdarg.h>
#include <string.h>
#include <Preferences.h>
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"

static const uint16_t MAX_PAYLOAD = MAX_LEDS * 3;
static uint8_t chunk[256];

// Persistent framebuffer (RGB, physical strip order). FRAME overwrites it whole; DELTA
// patches only the changed pixels; both then show it. Kept separate from the parser's
// receive buffer because a DELTA payload (idx+RGB entries) is NOT the framebuffer.
static uint8_t frameBuf[MAX_PAYLOAD];

// ---------------------------------------------------------------- runtime config (NVS-backed)
static Preferences prefs;
static uint8_t  ledPin     = LED_PIN_DEFAULT;
static uint16_t ledCount   = LED_COUNT_DEFAULT;
static uint8_t  brightness = BRIGHTNESS_DEFAULT;

// Portable across ESP32 variants: allow GPIO 0-5 and 14-23. Reject 6-11 (SPI flash on the
// classic ESP32), 12/13 (USB D-/D+ on the C6; flash-voltage strapping on the ESP32), and
// 24+ (flash / not bonded out on the classic module).
static bool pinUsable(uint8_t p) {
  return p <= 23 && !(p >= 6 && p <= 13);
}

// ---------------------------------------------------------------- link state
static uint32_t lastShowMs = 0;   // last strip transfer start

// ---------------------------------------------------------------- LED output (raw RMT, unchanged from reference)
static rmt_channel_handle_t rmtChan = NULL;
static rmt_encoder_handle_t rmtEnc  = NULL;
static uint8_t  wire[MAX_PAYLOAD];           // GRB, brightness-scaled
static int      rmtMem = 0;
static uint32_t rmtTimeouts = 0;
static bool     rmtBusy = false;

// Finish the PREVIOUS transfer (100 ms cap -> RMTERR, never a hang).
static void ledWaitPrev() {
  if (!rmtBusy) return;
  esp_err_t e = rmt_tx_wait_all_done(rmtChan, 100);
  rmtBusy = false;
  if (e != ESP_OK) { rmtTimeouts++; Serial.printf("RMTERR wait=%d\n", (int)e); }
}

static bool ledChannelCreate(uint8_t pin) {
  rmt_tx_channel_config_t cfg = {};
  cfg.clk_src           = RMT_CLK_SRC_DEFAULT;
  cfg.gpio_num          = (gpio_num_t)pin;
  cfg.resolution_hz     = 20000000;        // 50 ns ticks
  cfg.trans_queue_depth = 1;
  cfg.intr_priority     = 3;               // max the RMT driver allows; above the UART ISR
  // The driver requires mem_block_symbols to be a multiple of the per-chip block size, and
  // no single value fits every board (C6 = 48 words/block, classic ESP32 = 64). Try a ladder
  // that covers both: 96 (=2x48, the C6) then 64 (1x64, the classic ESP32) then 48 (1 block).
  // Whichever the running chip accepts first is the one used; BOOT reports it as mem=.
  static const uint16_t memLadder[] = {96, 64, 48};
  rmtChan = NULL; rmtMem = 0;
  for (uint8_t i = 0; i < sizeof(memLadder) / sizeof(memLadder[0]); i++) {
    cfg.mem_block_symbols = memLadder[i];
    if (rmt_new_tx_channel(&cfg, &rmtChan) == ESP_OK) { rmtMem = memLadder[i]; break; }
    rmtChan = NULL;
  }
  if (!rmtChan) return false;
  ESP_ERROR_CHECK(rmt_enable(rmtChan));
  return true;
}

static void ledInit() {
  rmt_bytes_encoder_config_t enc = {};
  enc.bit0.level0 = 1; enc.bit0.duration0 = 8;    // 0.40 us high
  enc.bit0.level1 = 0; enc.bit0.duration1 = 17;   // 0.85 us low
  enc.bit1.level0 = 1; enc.bit1.duration0 = 16;   // 0.80 us high
  enc.bit1.level1 = 0; enc.bit1.duration1 = 9;    // 0.45 us low
  enc.flags.msb_first = 1;
  ESP_ERROR_CHECK(rmt_new_bytes_encoder(&enc, &rmtEnc));
  ledChannelCreate(ledPin);
}

// Only from loop(), only on an ACTUAL pin change (channel churn was a v1 crash source,
// so this path is rare by construction). Waits for the strip to go idle first.
static void ledSetPin(uint8_t pin) {
  ledWaitPrev();
  if (rmtChan) { rmt_disable(rmtChan); rmt_del_channel(rmtChan); rmtChan = NULL; }
  ledChannelCreate(pin);
}

static void ledTransmit(uint16_t bytes) {
  rmt_transmit_config_t tx = {};
  tx.loop_count = 0;
  esp_err_t e = rmt_transmit(rmtChan, rmtEnc, wire, bytes, &tx);
  if (e != ESP_OK) { rmtTimeouts++; Serial.printf("RMTERR transmit=%d\n", (int)e); return; }
  rmtBusy = true;
  lastShowMs = millis();
}

// Non-blocking: finish the PREVIOUS frame (not this one), then start this one and return.
// The ~16 ms transfer overlaps the caller's next work, so the loop task keeps yielding.
static void ledShow(const uint8_t *rgb) {
  if (!rmtChan) return;
  ledWaitPrev();
  const uint16_t k = brightness + 1;                 // Adafruit: (c * (b+1)) >> 8
  const uint16_t n = ledCount;
  for (uint16_t i = 0; i < n; i++) {
    wire[i * 3]     = (rgb[i * 3 + 1] * k) >> 8;   // G
    wire[i * 3 + 1] = (rgb[i * 3]     * k) >> 8;   // R
    wire[i * 3 + 2] = (rgb[i * 3 + 2] * k) >> 8;   // B
  }
  ledTransmit(n * 3);
}

// Black out n LEDs (n may exceed ledCount, e.g. after a count decrease).
static void ledClear(uint16_t n) {
  if (!rmtChan) return;
  if (n > MAX_LEDS) n = MAX_LEDS;
  ledWaitPrev();
  memset(wire, 0, n * 3);
  ledTransmit(n * 3);
}

// ---------------------------------------------------------------- text output (serial)
static char lineBuf[160];
static void emit(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vsnprintf(lineBuf, sizeof(lineBuf), fmt, ap);
  va_end(ap);
  Serial.print(lineBuf);
}

// ---------------------------------------------------------------- config handling
// Only from loop(). Gated on ACTUAL change: the app sends CONFIG on every (re)connect,
// almost always identical, and re-running pin setup / NVS writes unconditionally is waste
// (and on v1, RMT churn).
static void applyConfig(uint8_t pin, uint16_t count, uint8_t bri, bool save) {
  if (count < 1) count = 1;
  if (count > MAX_LEDS) count = MAX_LEDS;
  if (!pinUsable(pin)) pin = ledPin;                     // rejected: keep current (CFG line shows it)

  bool pinChanged   = pin   != ledPin;
  bool countChanged = count != ledCount;
  bool briChanged   = bri   != brightness;
  if (!pinChanged && !countChanged && !briChanged) return;

  uint16_t oldCount = ledCount;
  if (pinChanged) { ledPin = pin; ledSetPin(pin); }
  ledCount = count; brightness = bri;
  if (pinChanged || countChanged) ledClear(oldCount > count ? oldCount : count);

  if (save) {
    if (pinChanged)   prefs.putUChar("pin", ledPin);
    if (countChanged) prefs.putUShort("count", ledCount);
    if (briChanged)   prefs.putUChar("bri", brightness);
  }
}

static void handleConfig(const uint8_t *p) {
  uint16_t count = p[1] | ((uint16_t)p[2] << 8);
  applyConfig(p[0], count, p[3], true);
  emit("CFG pin=%u count=%u bri=%u mem=%d delta=1\n", (unsigned)ledPin, (unsigned)ledCount, (unsigned)brightness, rmtMem);
}

// Patch changed pixels into frameBuf. Each entry is [idx_lo idx_hi R G B]; out-of-range
// indices are skipped (never write past the strip). Caller has validated len % 5 == 0.
static void applyDelta(const uint8_t *p, uint16_t len) {
  for (uint16_t i = 0; i + DELTA_ENTRY <= len; i += DELTA_ENTRY) {
    uint16_t idx = p[i] | ((uint16_t)p[i + 1] << 8);
    if (idx < ledCount) {
      frameBuf[idx * 3]     = p[i + 2];
      frameBuf[idx * 3 + 1] = p[i + 3];
      frameBuf[idx * 3 + 2] = p[i + 4];
    }
  }
}

// ---------------------------------------------------------------- packet parser (one per transport)
enum State : uint8_t { S_MAGIC1, S_MAGIC2, S_TYPE, S_SEQ, S_LEN_LO, S_LEN_HI, S_PAYLOAD, S_SUM_LO, S_SUM_HI };

// FRAME/CONFIG are fixed length; DELTA is variable (any non-empty multiple of 5 that fits the
// receive buffer). Validated at the len stage before the payload is accepted.
static inline bool lenValid(uint8_t type, uint16_t len) {
  if (type == PKT_FRAME)  return len == (uint16_t)(ledCount * 3);
  if (type == PKT_CONFIG) return len == CONFIG_LEN;
  if (type == PKT_DELTA)  return len >= DELTA_ENTRY && (len % DELTA_ENTRY) == 0 && len <= MAX_PAYLOAD;
  return false;                                          // unknown type -> rejected at len stage
}

struct Rx {
  const char *name;
  State    state = S_MAGIC1;
  uint16_t idx = 0, len = 0, sum = 0, rxSum = 0;
  uint8_t  type = 0, seq = 0, expectSeq = 0;
  bool     haveSeq = false;
  uint32_t nOk = 0, nBadSum = 0, nBadLen = 0, nLost = 0, nJunk = 0, peak = 0;
  uint8_t  buf[MAX_PAYLOAD];
  void feed(uint8_t b);
};
static Rx rxUsb{"usb"};

void Rx::feed(uint8_t b) {
  switch (state) {
    case S_MAGIC1:
      if (b == 0xA5) state = S_MAGIC2; else nJunk++;
      break;
    case S_MAGIC2:
      if (b == 0x5A) state = S_TYPE;
      else { nJunk++; state = (b == 0xA5) ? S_MAGIC2 : S_MAGIC1; }
      break;
    case S_TYPE:
      type = b; sum = b; state = S_SEQ;
      break;
    case S_SEQ:
      seq = b; sum += b; state = S_LEN_LO;
      break;
    case S_LEN_LO:
      len = b; sum += b; state = S_LEN_HI;
      break;
    case S_LEN_HI: {
      len |= (uint16_t)b << 8; sum += b;
      if (!lenValid(type, len)) {
        nBadLen++; state = S_MAGIC1;
#if DEBUG_STATS
        emit("BADLEN src=%s type=%u seq=%u len=%u\n", name, (unsigned)type, (unsigned)seq, (unsigned)len);
#endif
      } else { idx = 0; state = S_PAYLOAD; }
      break;
    }
    case S_PAYLOAD:
      buf[idx++] = b; sum += b;
      if (idx == len) state = S_SUM_LO;
      break;
    case S_SUM_LO:
      rxSum = b; state = S_SUM_HI;
      break;
    case S_SUM_HI:
      rxSum |= (uint16_t)b << 8;
      state = S_MAGIC1;
      if (rxSum != sum) {                            // never act on a bad packet
        nBadSum++;
#if DEBUG_STATS
        emit("BAD src=%s type=%u seq=%u got=%04x want=%04x\n", name, (unsigned)type, (unsigned)seq, (unsigned)rxSum, (unsigned)sum);
#endif
        break;
      }
      if (haveSeq && seq != expectSeq) nLost += (uint8_t)(seq - expectSeq);
      expectSeq = seq + 1; haveSeq = true;
      nOk++;
      if (type == PKT_FRAME)       { memcpy(frameBuf, buf, (size_t)ledCount * 3); ledShow(frameBuf); }
      else if (type == PKT_DELTA)  { applyDelta(buf, len); ledShow(frameBuf); }
      else if (type == PKT_CONFIG) handleConfig(buf);
#if ACK_AFTER_SHOW
      emit("OK %u\n", (unsigned)seq);
#endif
      break;
  }
}

// ---------------------------------------------------------------- setup / loop
static uint32_t lastStats = 0;
static uint32_t loopIters = 0;

void setup() {
  Serial.setRxBufferSize(RX_BUFFER_BYTES);   // MUST come before begin() on HardwareSerial
  Serial.begin(SERIAL_BAUD);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);   // native USB CDC: never block on prints when no host is reading
#endif

  prefs.begin(NVS_NAMESPACE, false);
  uint8_t  p = prefs.getUChar("pin", LED_PIN_DEFAULT);
  uint16_t c = prefs.getUShort("count", LED_COUNT_DEFAULT);
  brightness = prefs.getUChar("bri", BRIGHTNESS_DEFAULT);
  if (pinUsable(p)) ledPin = p;
  if (c >= 1 && c <= MAX_LEDS) ledCount = c;

  ledInit();                               // strip FIRST: it must claim its RMT TX block(s)
  memset(rxUsb.buf, 0, sizeof(rxUsb.buf));
  rxUsb.buf[0] = rxUsb.buf[1] = rxUsb.buf[2] = 30;   // boot blink: pixel 0 dim white confirms pin/count without the app
  ledShow(rxUsb.buf);
  rxUsb.buf[0] = rxUsb.buf[1] = rxUsb.buf[2] = 0;

#if defined(CONFIG_ESP_TASK_WDT_INIT) || defined(CONFIG_ESP_TASK_WDT)
  esp_task_wdt_add(NULL);   // register the Arduino loop task so we can feed it
#endif
  emit("BOOT v%s driver=rmt prio=3 mem=%d pin=%u leds=%u bri=%u reset=%d\n",
       FW_VERSION, rmtMem, (unsigned)ledPin, (unsigned)ledCount, (unsigned)brightness, (int)esp_reset_reason());
}

void loop() {
  loopIters++;
#if defined(CONFIG_ESP_TASK_WDT_INIT) || defined(CONFIG_ESP_TASK_WDT)
  esp_task_wdt_reset();
#endif
  // ---- USB / serial
  int avail = Serial.available();
  if ((uint32_t)avail > rxUsb.peak) rxUsb.peak = avail;
  while (avail > 0) {
    int want = avail < (int)sizeof(chunk) ? avail : (int)sizeof(chunk);
    int n = Serial.read(chunk, want);
    if (n <= 0) break;
    for (int i = 0; i < n; i++) rxUsb.feed(chunk[i]);
    avail -= n;
  }

  delay(1);   // let the IDLE task run; harmless to the ~50 fps ceiling here

#if DEBUG_STATS
  if (STATS_MS && (millis() - lastStats) >= STATS_MS) {
    uint32_t iters = loopIters; loopIters = 0;
    lastStats = millis();
    emit("STAT src=usb ok=%u badsum=%u badlen=%u lost=%u junk=%u peak=%u/%u rmterr=%u up=%u\n",
         (unsigned)rxUsb.nOk, (unsigned)rxUsb.nBadSum, (unsigned)rxUsb.nBadLen, (unsigned)rxUsb.nLost,
         (unsigned)rxUsb.nJunk, (unsigned)rxUsb.peak, (unsigned)RX_BUFFER_BYTES, (unsigned)rmtTimeouts, (unsigned)millis());
    emit("STAT src=idle iters=%u\n", (unsigned)iters);
    rxUsb.peak = 0;
    emit("STAT src=cfg pin=%u count=%u bri=%u\n", (unsigned)ledPin, (unsigned)ledCount, (unsigned)brightness);
  }
#endif
}
