/*
 * MATRIX STUDIO — ESP32 firmware
 * Receives LED frames from the Matrix Studio web app over USB serial or BLE (Nordic UART Service)
 * and drives WS2812B panels.
 *
 * Libraries (Library Manager):
 *   - Adafruit NeoPixel  (runtime pin/count, RMT-driven on ESP32)
 * BLE uses the bundled arduino-esp32 BLE library.
 *
 * Protocol (both transports, byte stream):
 *   [0xA5][0x5A][cmd][len_lo][len_hi][payload ...]
 *   cmd 0x01 FRAME : payload = count*3 bytes, RGB, already in physical strip order
 *   cmd 0x02 CONFIG: payload = [pin][count_lo][count_hi][brightness]  (persisted to NVS)
 *
 * Notes:
 *   - The web app does all the x/y -> strip-index mapping; this side is deliberately dumb.
 *   - 512 LEDs @ full white ≈ 30 A. Power-inject both panels, keep brightness capped,
 *     and put a 74AHCT125 (or similar) level shifter on the data line for reliable 5 V logic.
 *
 * Status LED (ESP32-C6 devkit: WS2812 RGB pixel on GPIO8):
 *   - BLE connected, idle ...... dim blue (~1/4 brightness, BLE_IDLE_PCT)
 *   - Serial link up, idle ..... steady yellow (LINK_IDLE_PCT)
 *   - Actively streaming ....... LED goes dark — status writes are suppressed
 *                                while frames flow so the onboard pixel never
 *                                drives RMT at the same time as the matrix strip
 *                                (that contention crashed the C6). Resumes once
 *                                the stream is quiet for STATUS_QUIET_MS.
 *   - Waiting for BLE .......... slow blue breathing (fade in/out) while advertising
 *   - Link lost (BLE/serial) ... brief black-out, then a white double-flash
 *   - Post-serial limbo ........ steady RED while nothing is connected and BLE
 *                                advertising hasn't resumed yet; turns to blue
 *                                breathing once BLE is advertising again
 *   The whole status LED can be disabled with STATUS_LED_ENABLED 0.
 *   Advertising is suppressed only while real USB-serial data is flowing, so an
 *   open Serial Monitor alone does not block BLE.
 *   Don't set the matrix output pin to the same GPIO as the status LED.
 */

#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#if defined(CONFIG_NIMBLE_ENABLED)
#include <host/ble_gap.h>    // ble_gap_set_prefer_default_le_phy (2M PHY preference)
#endif

#define MAX_LEDS      1024
#define SERIAL_BAUD   921600          // match the app setting (irrelevant on native USB CDC)
#define BLE_NAME      "MATRIX-ESP32"

#define NUS_SERVICE   "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX        "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // app writes here

/* ---------- onboard status LED ----------
 * ESP32-C6-DevKitC-1 / DevKitM-1: addressable WS2812 on GPIO8 (RGB_BUILTIN).
 * Boards with a plain single-colour LED fall back to digitalWrite on LED_BUILTIN
 * (no colours/fade there — data blink + slow "waiting" blink only).
 *
 * STATUS_LED_ENABLED — master switch. The onboard WS2812 is driven via the RMT
 * peripheral, the SAME scarce resource the matrix strip uses. On the C6 (few RMT
 * channels) the two can contend and, after a couple of minutes of heavy BLE
 * streaming, trip a driver assertion -> abort() -> reboot. Set this to 0 to take
 * the status LED off RMT entirely as a diagnostic / stability measure: if the
 * crashes stop with it at 0, the status LED's RMT use was the cause. Cosmetic
 * only — the matrix output is unaffected either way. */
#ifndef STATUS_LED_ENABLED
  #define STATUS_LED_ENABLED 1     // on by default; status writes are suppressed during
                                   // active streaming (see STATUS_QUIET_MS) so they never
                                   // collide with strip.show(). Set 0 to disable entirely
                                   // as a stability backstop.
#endif

#if defined(RGB_BUILTIN)
  #define STATUS_LED_PIN     RGB_BUILTIN
  #define STATUS_LED_IS_RGB  1
#elif defined(LED_BUILTIN)
  #define STATUS_LED_PIN     LED_BUILTIN
  #define STATUS_LED_IS_RGB  0
#else
  #define STATUS_LED_PIN     8      // C6 devkit WS2812 data pin
  #define STATUS_LED_IS_RGB  1
#endif

#define STATUS_QUIET_MS         300   // stream must be quiet this long before the status LED
                                      // resumes — guarantees no status show() overlaps a frame
                                      // draw (the RMT contention that crashed the C6)
#define STATUS_LED_MAX          90    // status LED cap (0-255); the percentages scale within this
#define LINK_IDLE_PCT           50    // steady level while a link is up but idle
#define BLE_IDLE_PCT            13    // BLE connected+idle: dim blue, ~1/4 of the normal idle level
#define SERIAL_LINK_TIMEOUT_MS  3000  // serial considered gone after this much silence
#define BREATH_PERIOD_MS        2400  // full fade-in/fade-out cycle while advertising
#define BREATH_MAX              60    // peak breathing brightness (0-255)
#define WHITE_FLASH_LEVEL       24    // brightness of the boot / disconnect white flashes

Preferences prefs;
Adafruit_NeoPixel strip(512, 5, NEO_GRB + NEO_KHZ800);

/* Onboard status pixel driven by its OWN persistent NeoPixel object rather than
 * rgbLedWrite(). This is the crux of the crash fix: rgbLedWrite() detaches and
 * reattaches its RMT channel on every call (arduino-esp32 PR #9906), and on the
 * C6's scarce RMT channels that thrash knocks the matrix strip's channel loose
 * ("GPIO 5 is not attached to an RMT channel"), which eventually trips a driver
 * assertion -> abort() -> reboot. A persistent NeoPixel object acquires its
 * channel once in begin() and holds it, so the two never fight.
 *
 * IMPORTANT: use the RAW GPIO number, not RGB_BUILTIN. On the C6, RGB_BUILTIN is
 * defined as (pin + SOC_GPIO_PIN_COUNT) — an offset flag that the core's own
 * neopixelWrite() understands but Adafruit_NeoPixel (depending on version) does
 * NOT, so passing RGB_BUILTIN here leaves the pixel dark. The onboard WS2812 is
 * plain GPIO 8 on C6 devkits. Override STATUS_PIX_GPIO if your board differs. */
#ifndef STATUS_PIX_GPIO
  #define STATUS_PIX_GPIO 8
#endif
#if STATUS_LED_ENABLED && STATUS_LED_IS_RGB
Adafruit_NeoPixel statusPix(1, STATUS_PIX_GPIO, NEO_GRB + NEO_KHZ800);
#endif

uint16_t ledCount   = 512;
uint8_t  ledPin     = 5;
uint8_t  brightness = 40;

/* ---------- link state (written from loop + BLE task, read in loop) ---------- */
volatile uint32_t lastRxMs       = 0;      // any-transport data activity
volatile uint32_t lastSerialRxMs = 0;      // serial-only data activity
volatile bool     bleConnected   = false;

uint32_t discoAnimStart = 0;               // loop-context only: disconnect-flash start time (0 = idle)

BLEAdvertising *bleAdv = nullptr;
bool bleAdvertisingOn  = false;

bool serialRecentData() {
  return lastSerialRxMs != 0 &&
         (millis() - lastSerialRxMs) < SERIAL_LINK_TIMEOUT_MS;
}

/* "The host really has the port open right now."
 * Native USB CDC can sense this (DTR); a UART bridge can't, so there we
 * fall back to recent data as the best available signal. */
bool serialHostUp() {
#if ARDUINO_USB_CDC_ON_BOOT
  return (bool)Serial;
#else
  return serialRecentData();
#endif
}

void setAdvertising(bool on) {
  if (!bleAdv || on == bleAdvertisingOn) return;
  if (on) bleAdv->start();
  else    bleAdv->stop();
  bleAdvertisingOn = on;
}

/* ---------- status LED ---------- */
static inline void statusLed(uint8_t r, uint8_t g, uint8_t b) {
#if !STATUS_LED_ENABLED
  (void)r; (void)g; (void)b;                      // status LED disabled — no-op (off RMT entirely)
#else
  static uint32_t last = 0xFFFFFFFF;              // skip redundant writes
  uint32_t packed = ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
  if (packed == last) return;
  last = packed;
#if STATUS_LED_IS_RGB
  // Persistent NeoPixel object — holds its own RMT channel, no attach/detach
  // thrash, so it never disturbs the matrix strip's channel. (See statusPix note.)
  statusPix.setPixelColor(0, statusPix.Color(r, g, b));
  statusPix.show();
#else
  digitalWrite(STATUS_LED_PIN, (r | g | b) ? HIGH : LOW);
#endif
#endif
}

/* Draw the status LED in the transport hue at pct% of STATUS_LED_MAX. */
static void statusHue(bool isBlue, uint8_t pct) {
  uint8_t lvl = (uint8_t)((uint16_t)STATUS_LED_MAX * pct / 100);
  if (isBlue) statusLed(0, 0, lvl);
  else        statusLed(lvl, (uint8_t)((uint16_t)lvl * 165 / 255), 0);  // amber-yellow
}

void updateStatusLed() {
  static uint32_t lastFrame = 0;
  uint32_t now = millis();
  if (now - lastFrame < 20) return;               // cap LED redraws at ~50 fps
  lastFrame = now;

  // CRITICAL for C6 stability: the onboard status LED and the matrix strip both
  // drive RMT. Two RMT show() calls interleaving during streaming is what crashed
  // the chip. So while frames are (or were just) flowing, we DON'T touch the status
  // LED at all — no writes, no show() — and only resume once the stream has been
  // quiet for STATUS_QUIET_MS, guaranteeing the strip's show() isn't mid-flight.
  // Trade-off: no per-packet data blink anymore; the LED simply goes dark while
  // actively streaming and shows link state (steady colour / breathing) when idle.
  bool streamRecent = lastRxMs != 0 && (now - lastRxMs) < STATUS_QUIET_MS;
  if (streamRecent) {
    discoAnimStart = 0;                            // fresh data cancels any goodbye flash
    statusLed(0, 0, 0);                            // one clean write to off, then hands off
    return;                                        // ...and no further status writes while streaming
  }

  // Disconnect goodbye flash (only reached once the stream is quiet).
  if (discoAnimStart) {
    uint32_t t = now - discoAnimStart;
    if (t < 520) {
      bool w = (t >= 200 && t < 280) || (t >= 360 && t < 440);
      uint8_t lvl = w ? WHITE_FLASH_LEVEL : 0;
      statusLed(lvl, lvl, lvl);
      return;
    }
    discoAnimStart = 0;
  }

  if (bleConnected) {
    statusHue(true, BLE_IDLE_PCT);                // BLE connected, idle: dim blue (~1/4 brightness)
  } else if (serialHostUp()) {
    statusHue(false, LINK_IDLE_PCT);              // serial host present, idle: steady yellow
  } else if (!bleAdvertisingOn) {
    // Limbo: nothing connected, advertising not yet resumed -> red
    statusLed((uint8_t)((uint16_t)STATUS_LED_MAX * LINK_IDLE_PCT / 100), 0, 0);
  } else {
    // waiting for BLE: slow breathing while advertising
#if STATUS_LED_IS_RGB
    uint32_t t    = now % BREATH_PERIOD_MS;
    uint32_t half = BREATH_PERIOD_MS / 2;
    uint32_t lin  = (t < half) ? (t * 255 / half)
                               : ((BREATH_PERIOD_MS - t) * 255 / half);
    uint8_t  lvl  = (uint8_t)(((lin * lin) >> 8) * BREATH_MAX / 255);  // gamma ~2
    statusLed(0, 0, lvl);
#else
    statusLed(0, 0, ((now / 500) & 1) ? 255 : 0); // plain LED: slow 1 Hz blink
#endif
  }
}

/* ---------- packet parser (shared by serial + BLE) ---------- */
enum PState { P_A5, P_5A, P_CMD, P_LEN1, P_LEN2, P_PAYLOAD };
static PState   pstate = P_A5;
static uint8_t  pcmd = 0;
static uint16_t plen = 0, ppos = 0;
static uint8_t  payload[MAX_LEDS * 3];

void applyConfig(uint8_t pin, uint16_t count, uint8_t bri, bool save) {
  static bool    begun    = false;
  static uint8_t curPin   = 255;
  static uint16_t curCount = 0;
  static uint8_t curBri   = 255;

  uint16_t newCount = constrain(count, (uint16_t)1, (uint16_t)MAX_LEDS);
  ledPin = pin; ledCount = newCount; brightness = bri;

  bool pinChanged   = !begun || (pin != curPin);
  bool countChanged = !begun || (newCount != curCount);
  bool briChanged   = !begun || (bri != curBri);

  // CRITICAL for C6 stability: updateLength() and setPin()/begin() each tear down
  // and re-create the strip's RMT channel. The app sends a CONFIG packet on every
  // connect AND every auto-reconnect, almost always with identical values — so
  // doing this work unconditionally churns the RMT channel repeatedly, which
  // eventually leaves GPIO 5 detached and crashes the driver (rmtDeinit / abort).
  // Only touch the RMT-affecting calls when the value in question ACTUALLY changed.
  if (countChanged) strip.updateLength(newCount);   // reallocs + re-inits RMT — avoid when unchanged
  if (pinChanged) {
    strip.setPin(pin);
    strip.begin();
  }
  if (briChanged) strip.setBrightness(bri);

  if (pinChanged || countChanged) {                 // only repaint when geometry changed
    strip.clear();
    strip.show();
  }

  begun = true; curPin = pin; curCount = newCount; curBri = bri;

  if (save) {
    prefs.putUChar("pin", ledPin);
    prefs.putUShort("count", ledCount);
    prefs.putUChar("bri", brightness);
  }
}

void handlePacket() {
  if (pcmd == 0x01) {                          // FRAME
    uint16_t n = plen / 3;
    if (n > ledCount) n = ledCount;
    for (uint16_t i = 0; i < n; i++) {
      strip.setPixelColor(i, payload[i * 3], payload[i * 3 + 1], payload[i * 3 + 2]);
    }
    strip.show();
  } else if (pcmd == 0x02 && plen >= 4) {      // CONFIG
    uint16_t count = payload[1] | (payload[2] << 8);
    applyConfig(payload[0], count, payload[3], true);
  }
}

void feed(uint8_t b) {
  switch (pstate) {
    case P_A5:   if (b == 0xA5) pstate = P_5A;                 break;
    case P_5A:   pstate = (b == 0x5A) ? P_CMD : P_A5;          break;
    case P_CMD:  pcmd = b; pstate = P_LEN1;                    break;
    case P_LEN1: plen = b; pstate = P_LEN2;                    break;
    case P_LEN2:
      plen |= ((uint16_t)b) << 8;
      if (plen == 0) { handlePacket(); pstate = P_A5; }
      else if (plen > sizeof(payload)) { pstate = P_A5; }      // garbage; resync
      else { ppos = 0; pstate = P_PAYLOAD; }
      break;
    case P_PAYLOAD:
      payload[ppos++] = b;
      if (ppos >= plen) { handlePacket(); pstate = P_A5; }
      break;
  }
}

/* ---------- BLE RX ring buffer ----------
 * The BLE onWrite callback (NimBLE host task) ONLY copies bytes in here;
 * parsing and strip.show() happen in loop(). Keeps the BLE host task fast so
 * heavy frame streaming can't starve the link, and means the packet parser is
 * only ever touched from one task. Single producer / single consumer. */
#define BLE_RING_SIZE 8192            // power of two
static uint8_t bleRing[BLE_RING_SIZE];
static volatile uint16_t ringHead = 0, ringTail = 0;  // head = BLE writer, tail = loop reader

static inline void ringPush(const uint8_t *d, size_t n) {
  uint16_t h = ringHead;
  for (size_t i = 0; i < n; i++) {
    uint16_t next = (uint16_t)((h + 1) & (BLE_RING_SIZE - 1));
    if (next == ringTail) break;      // full: drop; parser resyncs on next A5 5A header
    bleRing[h] = d[i];
    h = next;
  }
  ringHead = h;
}

/* ---------- BLE ---------- */
class RxCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    ringPush(c->getData(), c->getLength());   // just copy; loop() does the real work
  }
};

class SrvCallback : public BLEServerCallbacks {
  // Moderately tighter connection params than the stack default: a vanished app
  // (no clean gatt.disconnect()) is noticed in ~3 s. Don't go much tighter —
  // a 1 s supervision timeout proved fragile under heavy frame streaming.
#if defined(CONFIG_NIMBLE_ENABLED)               // ESP32-C6 / H2 builds: NimBLE host
  void onConnect(BLEServer *s, ble_gap_conn_desc *desc) override {
    bleConnected = true;
    bleAdvertisingOn = false;                    // stack stops advertising on connect
    // Request moderate connection params: 30-60 ms interval, 3 s supervision
    // timeout — detects a vanished central in ~3 s without being fragile under load.
    s->updateConnParams(desc->conn_handle,
                        24 /*30 ms*/, 48 /*60 ms*/, 0 /*latency*/, 300 /*3 s timeout*/);
  }
  void onDisconnect(BLEServer *, ble_gap_conn_desc *) override {
    bleConnected = false;                        // loop() decides whether to re-advertise
  }
#else                                            // classic ESP32 builds: Bluedroid host
  void onConnect(BLEServer *s, esp_ble_gatts_cb_param_t *param) override {
    bleConnected = true;
    bleAdvertisingOn = false;                    // stack stops advertising on connect
    s->updateConnParams(param->connect.remote_bda,
                        24 /*30 ms*/, 48 /*60 ms*/, 0 /*latency*/, 300 /*3 s timeout*/);
  }
  void onDisconnect(BLEServer *) override {
    bleConnected = false;
  }
#endif
};

void setupBLE() {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setMTU(247);
#if defined(CONFIG_NIMBLE_ENABLED)
  // Prefer the 2M PHY: roughly doubles throughput when the central supports it
  // (most modern laptops/phones do). Preference only — the central decides.
  // NB: NimBLE spells this 'prefered' (single r) — long-standing upstream typo.
  ble_gap_set_prefered_default_le_phy(BLE_GAP_LE_PHY_1M_MASK | BLE_GAP_LE_PHY_2M_MASK,
                                      BLE_GAP_LE_PHY_1M_MASK | BLE_GAP_LE_PHY_2M_MASK);
#endif
  BLEServer *server = BLEDevice::createServer();
  server->advertiseOnDisconnect(false);   // loop() is the sole advertising owner (both stacks)
  server->setCallbacks(new SrvCallback());
  BLEService *svc = server->createService(NUS_SERVICE);
  BLECharacteristic *rx = svc->createCharacteristic(
      NUS_RX,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallback());
  svc->start();
  bleAdv = server->getAdvertising();
  bleAdv->addServiceUUID(NUS_SERVICE);
  // advertising is NOT started here — loop() owns it (serial link gets priority)
}

/* ---------- setup / loop ---------- */
void setup() {
  prefs.begin("matrix", false);
  ledPin     = prefs.getUChar("pin", 5);
  ledCount   = prefs.getUShort("count", 512);
  brightness = prefs.getUChar("bri", 40);

#if !ARDUINO_USB_CDC_ON_BOOT
  Serial.setRxBufferSize(8192);   // high-fps frames over UART bridge need headroom
#endif
  Serial.begin(SERIAL_BAUD);

#if STATUS_LED_ENABLED
#if !STATUS_LED_IS_RGB
  pinMode(STATUS_LED_PIN, OUTPUT);
#else
  statusPix.begin();               // acquire the status pixel's RMT channel once, up front
  statusPix.setBrightness(255);    // we scale colours ourselves; keep NeoPixel's gamma out of it
  statusPix.show();                // latch it off
#endif
  // quick double-flash so you know the status LED works before any link exists
  for (int i = 0; i < 2; i++) {
    statusLed(WHITE_FLASH_LEVEL, WHITE_FLASH_LEVEL, WHITE_FLASH_LEVEL); delay(80);
    statusLed(0, 0, 0);                                                 delay(80);
  }
#endif

  applyConfig(ledPin, ledCount, brightness, false);

  // Boot blink: confirms strip config without the app
  strip.setPixelColor(0, 30, 30, 30);
  strip.show();

  setupBLE();
}

void loop() {
  if (Serial.available()) {
    uint32_t now = millis();
    lastRxMs = now;
    lastSerialRxMs = now;
    while (Serial.available()) feed((uint8_t)Serial.read());
  }

  // Drain BLE bytes queued by the NimBLE task — ALL parsing and strip.show()
  // happens here in loop(), so the BLE host task is never blocked.
  if (ringTail != ringHead) {
    lastRxMs = millis();
    while (ringTail != ringHead) {
      uint8_t b = bleRing[ringTail];
      ringTail = (uint16_t)((ringTail + 1) & (BLE_RING_SIZE - 1));
      feed(b);
    }
  }

  // Falling-edge detect: BLE dropped, or the serial HOST went away
  // (host-level, so the flash fires immediately, not after the data timeout)
  static bool prevBle = false, prevSerialHost = false;
  bool serHost = serialHostUp();
  if ((prevBle && !bleConnected) || (prevSerialHost && !serHost)) discoAnimStart = millis();
  prevBle        = bleConnected;
  prevSerialHost = serHost;

  // Serial priority for advertising is gated on actual DATA, not mere host
  // presence: an open Serial Monitor holds the USB port (serialHostUp() true)
  // but sends no frames, and must NOT suppress BLE. Real USB-serial streaming
  // (frames within the last few seconds) still claims priority.
  setAdvertising(!bleConnected && !serialRecentData());

  updateStatusLed();
}
