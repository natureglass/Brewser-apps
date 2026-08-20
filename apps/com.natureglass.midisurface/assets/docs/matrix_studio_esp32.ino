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
 */

#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define MAX_LEDS      1024
#define SERIAL_BAUD   921600          // match the app setting (irrelevant on native USB CDC)
#define BLE_NAME      "MATRIX-ESP32"

#define NUS_SERVICE   "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX        "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // app writes here

Preferences prefs;
Adafruit_NeoPixel strip(512, 5, NEO_GRB + NEO_KHZ800);

uint16_t ledCount   = 512;
uint8_t  ledPin     = 5;
uint8_t  brightness = 40;

/* ---------- packet parser (shared by serial + BLE) ---------- */
enum PState { P_A5, P_5A, P_CMD, P_LEN1, P_LEN2, P_PAYLOAD };
static PState   pstate = P_A5;
static uint8_t  pcmd = 0;
static uint16_t plen = 0, ppos = 0;
static uint8_t  payload[MAX_LEDS * 3];

void applyConfig(uint8_t pin, uint16_t count, uint8_t bri, bool save) {
  ledPin = pin;
  ledCount = constrain(count, (uint16_t)1, (uint16_t)MAX_LEDS);
  brightness = bri;
  strip.clear();
  strip.show();
  strip.updateLength(ledCount);
  strip.setPin(ledPin);
  strip.setBrightness(brightness);
  strip.begin();
  strip.clear();
  strip.show();
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

/* ---------- BLE ---------- */
class RxCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    uint8_t *d = c->getData();
    size_t   n = c->getLength();
    for (size_t i = 0; i < n; i++) feed(d[i]);
  }
};

class SrvCallback : public BLEServerCallbacks {
  void onConnect(BLEServer *)    override { }
  void onDisconnect(BLEServer *s) override { s->getAdvertising()->start(); }
};

void setupBLE() {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setMTU(247);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new SrvCallback());
  BLEService *svc = server->createService(NUS_SERVICE);
  BLECharacteristic *rx = svc->createCharacteristic(
      NUS_RX,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallback());
  svc->start();
  BLEAdvertising *adv = server->getAdvertising();
  adv->addServiceUUID(NUS_SERVICE);
  adv->start();
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

  applyConfig(ledPin, ledCount, brightness, false);

  // Boot blink: confirms strip config without the app
  strip.setPixelColor(0, 30, 30, 30);
  strip.show();

  setupBLE();
}

void loop() {
  while (Serial.available()) feed((uint8_t)Serial.read());
}
