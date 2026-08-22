/*
 * MATRIX STUDIO — ESP32-C6 firmware v2.0
 * Pair with Matrix_Studio.html (protocol v2) or simple_serial_panel.html v17 (diagnostic page).
 *
 * BASE: simple_serial_panel.ino v15 — the streaming transport that was debugged on
 * hardware (see BLE_LED_streaming_findings.md). Matrix Studio's app features are ported
 * ONTO that base. The transport + LED driver are unchanged except for two things:
 *   (1) a type byte in the packet header so CONFIG and FRAME coexist on the wire;
 *   (2) pin / LED count / brightness are runtime values (NVS-backed) instead of #defines.
 *
 * Protocol v2 (both transports, little-endian byte stream):
 *   A5 5A | type | seq | len_lo len_hi | payload[len] | sum_lo sum_hi
 *   type 0x01 FRAME   len = ledCount*3 (strict)   payload = R G B per LED, physical strip order
 *   type 0x02 CONFIG  len = 4                     payload = [pin][count_lo][count_hi][brightness]
 *   sum  = (type + seq + len_lo + len_hi + sum(payload)) mod 65536
 *   seq  = one 8-bit counter on the sender, +1 per packet of ANY type.
 *   Every accepted packet is answered "OK <seq>\n"; CONFIG additionally answers
 *   "CFG pin=.. count=.. bri=.. mem=..\n" with the values actually in effect.
 *   A packet whose type is unknown, whose len does not match, or whose checksum fails is
 *   dropped and the parser re-syncs on the next A5 5A. No recovery pass (measured worse).
 *
 * Things deliberately NOT in this file — do not re-add them:
 *   - Adafruit_NeoPixel for the strip: blocking show() starves IDLE under BLE -> task WDT.
 *   - c->getData()/getValue() in the BLE write callback: stale bytes under back-to-back
 *     writes (the old "first ~128 LEDs ok, rest scrambled"). Ingest param->write.value.
 *   - RMT for the status LED: mem_block_symbols=96 takes BOTH C6 RMT TX blocks.
 *   - Manual resync/rescan passes in the parser.
 *
 * Transport design (from the reference):
 *   - USB/serial: bytes are read in loop() and fed to parser rxUsb.
 *   - BLE: the NUS RX write callback runs in the Bluetooth task and only pushes the write
 *     event's bytes into an 8 KB ring; loop() drains the ring into parser rxBle.
 *     ledShow() is ONLY ever called from loop().
 *   - Raw RMT TX at interrupt priority 3, 96 mem symbols (above the UART ISR, refill
 *     deadline ~60 us). ledShow() is non-blocking: it waits for the PREVIOUS frame's
 *     transfer at entry, starts this one and returns, so the loop task keeps yielding.
 *   - loop() feeds the task WDT and delay(1)s so IDLE/BLE tasks run.
 *
 * Status LED (ESP32-C6 devkit WS2812 on GPIO 8), bit-banged, never RMT:
 *   - BLE advertising, nothing connected ..... slow blue breathing
 *   - BLE connected ......................... off
 *   - USB-serial host has the port open ..... steady yellow
 *   A status write masks interrupts for ~30 us, so it is only ever issued while the strip's
 *   RMT transfer is idle (the only time it could matter). Breathing is the only repeated
 *   writer and it runs only when nothing is connected.
 *
 * Advertising is owned by loop(): on whenever BLE is not connected and no real USB-serial
 * DATA has arrived in the last SERIAL_LINK_TIMEOUT_MS. An open Serial Monitor alone does
 * not block BLE.
 *
 * Runtime pin rules (C6): GPIO 0-23 usable; 24-30 are SPI flash; 12/13 are USB D-/D+;
 * STATUS_PIX_GPIO is reserved. A CONFIG with an unusable pin keeps the current pin and
 * says so in the CFG line.
 */
#define FW_VERSION            "2.0"
#define LED_PIN_DEFAULT       20
#define LED_COUNT_DEFAULT     512
#define BRIGHTNESS_DEFAULT    40      // Adafruit scale: out = (c * (b+1)) >> 8
#define MAX_LEDS              1024
#define SERIAL_BAUD           921600  // irrelevant on native USB CDC, matters on a UART bridge
#define RX_BUFFER_BYTES       8192
#define BLE_ENABLE            1
#define BLE_NAME              "MATRIX-ESP32"
#define BLE_RING_BYTES        8192    // power of two
#define NVS_NAMESPACE         "matrix2"   // v1 used "matrix"; new namespace so a stale pin=5 never loads
#define ACK_AFTER_SHOW        1       // "OK <seq>" after every accepted packet (app paces BLE on it)
#define DEBUG_STATS           0       // 1 = STAT lines every second + BLW write trace + BAD/BADLEN lines
#define STATS_MS              1000

#define STATUS_LED_ENABLED    1
#define STATUS_PIX_GPIO       8
#define STATUS_YELLOW_LEVEL   45      // 0-255, steady yellow while a serial host is attached
#define BREATH_PERIOD_MS      2400    // full fade-in/fade-out while advertising
#define BREATH_MAX            60      // peak breathing level (0-255)
#define BOOT_FLASH_LEVEL      24
#define SERIAL_LINK_TIMEOUT_MS 3000   // serial DATA considered gone after this much silence

#define PKT_FRAME             0x01
#define PKT_CONFIG            0x02
#define CONFIG_LEN            4

#include <stdarg.h>
#include <string.h>
#include <Preferences.h>
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"
#if STATUS_LED_ENABLED
#include "esp_cpu.h"
#include "hal/gpio_ll.h"
#endif

static const uint16_t MAX_PAYLOAD = MAX_LEDS * 3;
static uint8_t chunk[256];

// ---------------------------------------------------------------- runtime config (NVS-backed)
static Preferences prefs;
static uint8_t  ledPin     = LED_PIN_DEFAULT;
static uint16_t ledCount   = LED_COUNT_DEFAULT;
static uint8_t  brightness = BRIGHTNESS_DEFAULT;

static bool pinUsable(uint8_t p) {
  return p <= 23 && p != STATUS_PIX_GPIO && p != 12 && p != 13;
}

// ---------------------------------------------------------------- link state
static volatile uint32_t lastRxMs       = 0;   // any-transport data activity (written from loop)
static volatile uint32_t lastSerialRxMs = 0;   // serial-only data activity
static uint32_t          lastShowMs     = 0;   // last strip transfer start

static bool serialRecentData() {
  return lastSerialRxMs != 0 && (millis() - lastSerialRxMs) < SERIAL_LINK_TIMEOUT_MS;
}
// "The host really has the port open." Native USB CDC senses DTR; a UART bridge can't,
// so there recent data is the best available signal.
static bool serialHostUp() {
#if ARDUINO_USB_CDC_ON_BOOT
  return (bool)Serial;
#else
  return serialRecentData();
#endif
}

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
// True if no strip transfer is in flight (non-blocking probe). Used by the status LED.
static bool ledIdle() {
  if (!rmtBusy) return true;
  if (rmt_tx_wait_all_done(rmtChan, 0) == ESP_OK) { rmtBusy = false; return true; }
  return false;
}

static bool ledChannelCreate(uint8_t pin) {
  rmt_tx_channel_config_t cfg = {};
  cfg.clk_src           = RMT_CLK_SRC_DEFAULT;
  cfg.gpio_num          = (gpio_num_t)pin;
  cfg.resolution_hz     = 20000000;        // 50 ns ticks
  cfg.trans_queue_depth = 1;
  cfg.intr_priority     = 3;               // max the RMT driver allows; above the UART ISR
  cfg.mem_block_symbols = 96;              // both C6 TX blocks -> refill every 48 symbols
  if (rmt_new_tx_channel(&cfg, &rmtChan) != ESP_OK) {
    cfg.mem_block_symbols = 48;            // BOOT line reports mem=48 if this ever happens
    if (rmt_new_tx_channel(&cfg, &rmtChan) != ESP_OK) { rmtChan = NULL; rmtMem = 0; return false; }
  }
  rmtMem = cfg.mem_block_symbols;
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

// ---------------------------------------------------------------- BLE (Nordic UART, unchanged from reference)
#if BLE_ENABLE
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define NUS_SERVICE "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"   // central writes here
#define NUS_TX      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"   // we notify here

static BLECharacteristic *bleTx = NULL;
static BLEAdvertising    *bleAdv = NULL;
static volatile bool bleConnected = false;
static bool bleAdvertisingOn = false;

// single-producer (BLE task) / single-consumer (loop task) byte ring
static uint8_t  bleRing[BLE_RING_BYTES];
static volatile uint32_t bleHead = 0, bleTail = 0;
static volatile uint32_t bleDrop = 0, bleRxBytes = 0, bleWrites = 0, bleMaxWrite = 0;
static volatile uint16_t bleMtu = 0;
static volatile bool     bleMtuChanged = false;
#define BLE_MASK (BLE_RING_BYTES - 1)

#if DEBUG_STATS
// trace of the first writes after each connect (filled in the BLE task, printed by loop)
#define BLW_TRACE 12
struct BlwRec { uint16_t len, vlen, off; uint8_t prep; uint8_t head[8]; };
static BlwRec   blwRec[BLW_TRACE];
static volatile uint8_t blwCount = 0, blwPrinted = 0;
#endif

// loop() is the sole owner of advertising (serial data gets priority).
static void setAdvertising(bool on) {
  if (!bleAdv || on == bleAdvertisingOn) return;
  if (on) bleAdv->start(); else bleAdv->stop();
  bleAdvertisingOn = on;
}

class ServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleConnected = true; bleAdvertisingOn = false;       // stack stops advertising on connect
#if DEBUG_STATS
    blwCount = blwPrinted = 0;
#endif
  }
#ifdef CONFIG_BLUEDROID_ENABLED
  void onConnect(BLEServer *srv, esp_ble_gatts_cb_param_t *param) override {
    bleConnected = true; bleAdvertisingOn = false;
#if DEBUG_STATS
    blwCount = blwPrinted = 0;
#endif
    // ask the central for a 7.5-15 ms connection interval, 4 s supervision timeout
    srv->updateConnParams(param->connect.remote_bda, 0x06, 0x0C, 0, 400);
  }
  void onMtuChanged(BLEServer *, esp_ble_gatts_cb_param_t *param) override { bleMtu = param->mtu.mtu; bleMtuChanged = true; }
#endif
  void onDisconnect(BLEServer *) override { bleConnected = false; }   // loop() re-advertises
};

// Runs in the BLE task: push the bytes of THIS write into the ring. Nothing else.
static void bleIngest(const uint8_t *d, size_t n, size_t vlen, uint8_t prep, uint16_t off) {
  bleRxBytes += n; bleWrites++;
  if (n > bleMaxWrite) bleMaxWrite = n;
#if DEBUG_STATS
  if (blwCount < BLW_TRACE && n > 0 && d[0] == 0xA5) {   // only writes that begin a packet
    BlwRec &r = blwRec[blwCount];
    r.len = (uint16_t)n; r.vlen = (uint16_t)vlen; r.prep = prep; r.off = off;
    memset(r.head, 0, 8);
    memcpy(r.head, d, n < 8 ? n : 8);
    blwCount = blwCount + 1;
  }
#else
  (void)vlen; (void)prep; (void)off;
#endif
  uint32_t h = bleHead;
  for (size_t i = 0; i < n; i++) {
    uint32_t next = (h + 1) & BLE_MASK;
    if (next == bleTail) { bleDrop += (n - i); break; }   // ring full: drop the rest
    bleRing[h] = d[i];
    h = next;
  }
  bleHead = h;
}

class RxCb : public BLECharacteristicCallbacks {
#ifdef CONFIG_BLUEDROID_ENABLED
  // Bluedroid: the event carries the write's own bytes. Use them, not the stored value.
  void onWrite(BLECharacteristic *c, esp_ble_gatts_cb_param_t *p) override {
    if (p && p->write.value && p->write.len > 0 && p->write.len <= 600)
      bleIngest(p->write.value, p->write.len, c->getLength(), p->write.is_prep, p->write.offset);
    else
      bleIngest(c->getData(), c->getLength(), c->getLength(), 0xFF, 0);   // exec-write path: committed value
  }
#else
  void onWrite(BLECharacteristic *c) override { bleIngest(c->getData(), c->getLength(), c->getLength(), 0, 0); }
#endif
};

static void bleInit() {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setMTU(517);
  BLEServer *srv = BLEDevice::createServer();
  srv->advertiseOnDisconnect(false);       // loop() decides when to advertise
  srv->setCallbacks(new ServerCb());
  BLEService *svc = srv->createService(NUS_SERVICE);
  bleTx = svc->createCharacteristic(NUS_TX, BLECharacteristic::PROPERTY_NOTIFY);
  bleTx->addDescriptor(new BLE2902());
  BLECharacteristic *rx = svc->createCharacteristic(NUS_RX,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCb());
  svc->start();
  bleAdv = BLEDevice::getAdvertising();
  bleAdv->addServiceUUID(NUS_SERVICE);
  bleAdv->setScanResponse(true);
  bleAdv->setMinPreferred(0x06);   // ask for a short connection interval (central may ignore)
  bleAdv->setMaxPreferred(0x0C);
  // advertising is NOT started here — loop() owns it
}

static void bleNotifyText(const char *s) {
  if (!bleConnected || !bleTx) return;
  size_t n = strlen(s);
  for (size_t off = 0; off < n; off += 20) {           // 20-byte chunks: works with any MTU
    size_t k = (n - off) < 20 ? (n - off) : 20;
    bleTx->setValue((uint8_t *)(s + off), k);
    bleTx->notify();
  }
}
#else
static volatile bool bleConnected = false;
static bool bleAdvertisingOn = false;
static void setAdvertising(bool) {}
static void bleInit() {}
static void bleNotifyText(const char *) {}
#endif

// ---------------------------------------------------------------- text output to both transports
static char lineBuf[160];
static void emit(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vsnprintf(lineBuf, sizeof(lineBuf), fmt, ap);
  va_end(ap);
  Serial.print(lineBuf);
  bleNotifyText(lineBuf);
}

// ---------------------------------------------------------------- status LED (GPIO 8, bit-banged)
#if STATUS_LED_ENABLED
static uint32_t bbT0H = 64, bbT1H = 128, bbPeriod = 200;   // cycles; recomputed in statusInit()

static void statusInit() {
  pinMode(STATUS_PIX_GPIO, OUTPUT);
  digitalWrite(STATUS_PIX_GPIO, LOW);
  uint32_t mhz = getCpuFrequencyMhz();                     // 160 on the C6
  bbT0H = mhz * 40 / 100;  bbT1H = mhz * 80 / 100;  bbPeriod = mhz * 125 / 100;
}

// One WS2812 pixel, 24 bits, ~30 us with interrupts masked. Caller guarantees the strip's
// RMT transfer is idle (see updateStatusLed), so the masking can't starve its refill ISR.
static void IRAM_ATTR statusWrite(uint8_t r, uint8_t g, uint8_t b) {
  uint32_t data = ((uint32_t)g << 16) | ((uint32_t)r << 8) | b;   // GRB, MSB first
  portDISABLE_INTERRUPTS();
  for (int i = 23; i >= 0; i--) {
    uint32_t high = ((data >> i) & 1u) ? bbT1H : bbT0H;
    uint32_t t0 = esp_cpu_get_cycle_count();
    gpio_ll_set_level(&GPIO, STATUS_PIX_GPIO, 1);
    while ((uint32_t)(esp_cpu_get_cycle_count() - t0) < high) {}
    gpio_ll_set_level(&GPIO, STATUS_PIX_GPIO, 0);
    while ((uint32_t)(esp_cpu_get_cycle_count() - t0) < bbPeriod) {}
  }
  portENABLE_INTERRUPTS();
  // latch = line low >= 50 us; the next write is never sooner than 20 ms away
}

static uint32_t statusWant = 0, statusHave = 0xFFFFFFFF;   // packed RGB; "have" = last written

static inline void statusColor(uint8_t r, uint8_t g, uint8_t b) {
  statusWant = ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

// Decide the colour at ~50 Hz; actually write it as soon as the strip is idle.
static void updateStatusLed() {
  static uint32_t lastTick = 0;
  uint32_t now = millis();
  if (now - lastTick >= 20) {
    lastTick = now;
    if (bleConnected) {
      statusColor(0, 0, 0);                                                  // BLE connected: off
    } else if (serialHostUp()) {
      statusColor(STATUS_YELLOW_LEVEL, (uint8_t)((uint16_t)STATUS_YELLOW_LEVEL * 165 / 255), 0);
    } else if (bleAdvertisingOn) {                                           // waiting for BLE: breathe
      uint32_t t    = now % BREATH_PERIOD_MS;
      uint32_t half = BREATH_PERIOD_MS / 2;
      uint32_t lin  = (t < half) ? (t * 255 / half) : ((BREATH_PERIOD_MS - t) * 255 / half);
      uint8_t  lvl  = (uint8_t)(((lin * lin) >> 8) * BREATH_MAX / 255);      // gamma ~2
      statusColor(0, 0, lvl);
    } else {
      statusColor(0, 0, 0);                                                  // limbo between links
    }
  }
  if (statusWant != statusHave && ledIdle()) {
    statusHave = statusWant;
    statusWrite((statusWant >> 16) & 255, (statusWant >> 8) & 255, statusWant & 255);
  }
}

static void statusBootFlash() {
  ledWaitPrev();
  for (int i = 0; i < 2; i++) {
    statusWrite(BOOT_FLASH_LEVEL, BOOT_FLASH_LEVEL, BOOT_FLASH_LEVEL); delay(80);
    statusWrite(0, 0, 0);                                                delay(80);
  }
}
#else
static void statusInit() {}
static void updateStatusLed() {}
static void statusBootFlash() {}
#endif

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
  emit("CFG pin=%u count=%u bri=%u mem=%d\n", (unsigned)ledPin, (unsigned)ledCount, (unsigned)brightness, rmtMem);
}

// ---------------------------------------------------------------- packet parser (one per transport)
enum State : uint8_t { S_MAGIC1, S_MAGIC2, S_TYPE, S_SEQ, S_LEN_LO, S_LEN_HI, S_PAYLOAD, S_SUM_LO, S_SUM_HI };

static inline uint16_t expectedLen(uint8_t type) {
  if (type == PKT_FRAME)  return ledCount * 3;
  if (type == PKT_CONFIG) return CONFIG_LEN;
  return 0;                                              // unknown type -> rejected at len stage
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
static Rx rxBle{"ble"};

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
      uint16_t want = expectedLen(type);
      if (want == 0 || len != want) {
        nBadLen++; state = S_MAGIC1;
#if DEBUG_STATS
        emit("BADLEN src=%s type=%u seq=%u len=%u want=%u\n", name, (unsigned)type, (unsigned)seq, (unsigned)len, (unsigned)want);
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
      if (type == PKT_FRAME)       ledShow(buf);
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

  ledInit();                               // strip FIRST: it must get both RMT TX blocks
  memset(rxUsb.buf, 0, sizeof(rxUsb.buf));
  rxUsb.buf[0] = rxUsb.buf[1] = rxUsb.buf[2] = 30;   // boot blink: pixel 0 dim white confirms pin/count without the app
  ledShow(rxUsb.buf);
  rxUsb.buf[0] = rxUsb.buf[1] = rxUsb.buf[2] = 0;

  statusInit();
  statusBootFlash();

  bleInit();
#if defined(CONFIG_ESP_TASK_WDT_INIT) || defined(CONFIG_ESP_TASK_WDT)
  esp_task_wdt_add(NULL);   // register the Arduino loop task so we can feed it
#endif
  emit("BOOT v%s driver=rmt prio=3 mem=%d pin=%u leds=%u bri=%u ble=%d reset=%d\n",
       FW_VERSION, rmtMem, (unsigned)ledPin, (unsigned)ledCount, (unsigned)brightness, BLE_ENABLE, (int)esp_reset_reason());
}

void loop() {
  loopIters++;
#if defined(CONFIG_ESP_TASK_WDT_INIT) || defined(CONFIG_ESP_TASK_WDT)
  esp_task_wdt_reset();
#endif
  // ---- USB / serial
  int avail = Serial.available();
  if (avail > 0) { uint32_t now = millis(); lastRxMs = now; lastSerialRxMs = now; }
  if ((uint32_t)avail > rxUsb.peak) rxUsb.peak = avail;
  while (avail > 0) {
    int want = avail < (int)sizeof(chunk) ? avail : (int)sizeof(chunk);
    int n = Serial.read(chunk, want);
    if (n <= 0) break;
    for (int i = 0; i < n; i++) rxUsb.feed(chunk[i]);
    avail -= n;
  }

  // ---- BLE ring
#if BLE_ENABLE
  if (bleMtuChanged) { bleMtuChanged = false; emit("MTU %u\n", (unsigned)bleMtu); }
#if DEBUG_STATS
  while (blwPrinted < blwCount) {
    BlwRec &r = blwRec[blwPrinted];
    emit("BLW #%u len=%u vlen=%u prep=%u off=%u %02x %02x %02x %02x %02x %02x %02x %02x\n",
         (unsigned)blwPrinted + 1, (unsigned)r.len, (unsigned)r.vlen, (unsigned)r.prep, (unsigned)r.off,
         r.head[0], r.head[1], r.head[2], r.head[3], r.head[4], r.head[5], r.head[6], r.head[7]);
    blwPrinted = blwPrinted + 1;
  }
#endif
  uint32_t fill = (bleHead - bleTail) & BLE_MASK;
  if (fill > rxBle.peak) rxBle.peak = fill;
  if (bleTail != bleHead) lastRxMs = millis();
  while (bleTail != bleHead) {
    uint8_t b = bleRing[bleTail];
    bleTail = (bleTail + 1) & BLE_MASK;
    rxBle.feed(b);
  }
#endif

  delay(1);   // let IDLE / BLE tasks run; harmless to the ~50 fps ceiling here

  // Advertise only when BLE is free and no real USB-serial DATA is flowing
  // (an open Serial Monitor holds the port but sends nothing -> must not block BLE).
  setAdvertising(!bleConnected && !serialRecentData());
  updateStatusLed();

#if DEBUG_STATS
  if (STATS_MS && (millis() - lastStats) >= STATS_MS) {
    uint32_t iters = loopIters; loopIters = 0;
    lastStats = millis();
    emit("STAT src=usb ok=%u badsum=%u badlen=%u lost=%u junk=%u peak=%u/%u rmterr=%u up=%u\n",
         (unsigned)rxUsb.nOk, (unsigned)rxUsb.nBadSum, (unsigned)rxUsb.nBadLen, (unsigned)rxUsb.nLost,
         (unsigned)rxUsb.nJunk, (unsigned)rxUsb.peak, (unsigned)RX_BUFFER_BYTES, (unsigned)rmtTimeouts, (unsigned)millis());
    emit("STAT src=idle iters=%u\n", (unsigned)iters);
    rxUsb.peak = 0;
#if BLE_ENABLE
    emit("STAT src=ble ok=%u badsum=%u badlen=%u lost=%u junk=%u peak=%u/%u drop=%u conn=%u rxbytes=%u writes=%u maxw=%u rmterr=%u up=%u\n",
         (unsigned)rxBle.nOk, (unsigned)rxBle.nBadSum, (unsigned)rxBle.nBadLen, (unsigned)rxBle.nLost,
         (unsigned)rxBle.nJunk, (unsigned)rxBle.peak, (unsigned)BLE_RING_BYTES,
         (unsigned)bleDrop, (unsigned)bleConnected, (unsigned)bleRxBytes, (unsigned)bleWrites, (unsigned)bleMaxWrite,
         (unsigned)rmtTimeouts, (unsigned)millis());
    emit("STAT src=blemtu mtu=%u\n", (unsigned)bleMtu);
    emit("STAT src=cfg pin=%u count=%u bri=%u adv=%u\n", (unsigned)ledPin, (unsigned)ledCount, (unsigned)brightness, (unsigned)bleAdvertisingOn);
    rxBle.peak = 0;
#endif
  }
#endif
}
