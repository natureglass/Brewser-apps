// console.* on the engine can flip nxjs into text-render mode mid-frame.
try {
	console.warn = () => {};
	console.log = () => {};
	console.error = () => {};
	console.info = () => {};
} catch (_) {}

const canvas = document.getElementById('sunset-canvas');

// Enter fullscreen automatically on launch (mirrors pvzge's pattern).
// Engine implements canvas.requestFullscreen() via the swb shell. AWAIT
// the mode flip BEFORE reading parent BCR so canvas.width/height get the
// fullscreen pixel dims from the start.
const fullscreenP = (canvas && typeof canvas.requestFullscreen === 'function')
	? canvas.requestFullscreen().catch(() => {})
	: Promise.resolve();

fullscreenP.then(() => {
	const parent = canvas.parentElement;
	const bcr = parent.getBoundingClientRect();
	canvas.width = bcr.width || canvas.width || 1280;
	canvas.height = bcr.height || canvas.height || 720;
	initDemo();
}).catch(() => {});

function initDemo() {
try {
	const W = canvas.width;
	const H = canvas.height;

	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: false,
		depth: false,
		stencil: false,
		preserveDrawingBuffer: false,
	});
	if (!gl) throw new Error('WebGL 2 not available');
	if (typeof gl.enableGpuBridgePrototype === 'function') {
		gl.enableGpuBridgePrototype(true);
	}

	const vertexSource = document.getElementById('vertexShader').textContent.trim();
	const fragmentSource = document.getElementById('fragmentShader').textContent.trim();

	function compile(type, src, label) {
		const s = gl.createShader(type);
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			const log = gl.getShaderInfoLog(s) || 'unknown';
			throw new Error(label + ' compile: ' + log.slice(0, 200));
		}
		return s;
	}

	const vs = compile(gl.VERTEX_SHADER, vertexSource, 'vs');
	const fs = compile(gl.FRAGMENT_SHADER, fragmentSource, 'fs');
	const program = gl.createProgram();
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) || 'unknown';
		throw new Error('link: ' + log.slice(0, 200));
	}
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	gl.useProgram(program);

	// gl_VertexID drives a const-array fullscreen triangle in the vertex
	// shader — no attribute data needed. A VAO is still required by GLSL ES
	// 3.00 even when there are no enabled attribs.
	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	// nx.js's drawArrays gate (webgl.c:7304-7314) requires attribute 0 to
	// be enabled with type FLOAT and size >= 2 BEFORE try_draw_passthrough
	// gets a chance — the gate was designed for the bridge's hardcoded
	// `a_position`-bound color/texture programs. Our raw-passthrough
	// shader uses `gl_VertexID` + a const-array triangle and never reads
	// from a vertex attribute, but the gate doesn't know that and would
	// set GL_INVALID_OPERATION (0x502) every frame without ever
	// dispatching the draw. Bind a tiny dummy buffer + enable attr 0 to
	// satisfy the gate; the shader ignores whatever data sits there.
	const dummyBuf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, dummyBuf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 0, 0]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

	const U = {
		res: gl.getUniformLocation(program, 'uResolution'),
		time: gl.getUniformLocation(program, 'uTime'),
		look: gl.getUniformLocation(program, 'uLook'),
		fov: gl.getUniformLocation(program, 'uFov'),
		mood: gl.getUniformLocation(program, 'uMood'),
		logo: gl.getUniformLocation(program, 'uLogo'),
		logoReady: gl.getUniformLocation(program, 'uLogoReady'),
		cubeCenter: gl.getUniformLocation(program, 'uCubeCenter'),
		cubeR: gl.getUniformLocation(program, 'uCubeR'),
		cubeInvR: gl.getUniformLocation(program, 'uCubeInvR'),
	};

	// ----- Logo texture -----
	// 1x1 placeholder so the sampler stays valid until the PNG arrives.
	const TEX_SIZE = 1024;
	const logoTexture = gl.createTexture();
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, logoTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
		new Uint8Array([220, 230, 255, 255]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.uniform1i(U.logo, 0);

	let logoReady = false;
	// Allocate the persistent native texture handle BEFORE the async PNG
	// arrives (see [[bridge-fbo-support]] / nxjs-webgl-demo notes — without
	// the NULL-data allocation the later upload only populates nx.js's
	// CPU-side cache and `gl.bindTexture` doesn't forward to native).
	//
	// DIAGNOSTIC PROBES (TEMP) — verify the path resolution + track load.
	try {
		console.debug('[logo-probe webgl2demo] location.href=' +
			((typeof globalThis !== 'undefined' && globalThis.location)
				? String(globalThis.location.href) : '<no location>'));
	} catch (_) {}
	const logoImage = new Image();
	logoImage.onload = () => {
		try {
			console.debug('[logo-probe webgl2demo] onload w=' + logoImage.naturalWidth +
				' h=' + logoImage.naturalHeight + ' src=' + logoImage.src);
		} catch (_) {}
		try {
			const off = new OffscreenCanvas(TEX_SIZE, TEX_SIZE);
			const tctx = off.getContext('2d');
			tctx.fillStyle = '#111111';
			tctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
			const pad = 96;
			// Vertically flip the PNG before upload. GL textures sample
			// origin-at-bottom-left but the host demo's `gl.pixelStorei
			// (UNPACK_FLIP_Y_WEBGL, true)` is a no-op in nx.js (see
			// [[nxjs-webgl-shader-names]]), so the logo would otherwise
			// land on the cube upside-down. Doing the flip in the 2D
			// canvas (translate + scale(1, -1)) means the bytes that
			// `getImageData` returns are already in the orientation the
			// sampler expects, and `texImage2D(buffer-source)` uploads
			// them verbatim.
			tctx.save();
			tctx.translate(0, TEX_SIZE);
			tctx.scale(1, -1);
			tctx.drawImage(logoImage, pad, pad, TEX_SIZE - pad * 2, TEX_SIZE - pad * 2);
			tctx.restore();
			const imgData = tctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, logoTexture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_SIZE, TEX_SIZE, 0,
				gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(imgData.data.buffer));
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			logoReady = true;
		} catch (e) {
			try { console.debug('[logo-probe webgl2demo] upload threw: ' + String(e && e.message || e)); } catch (_) {}
		}
	};
	logoImage.onerror = (ev) => {
		try {
			console.debug('[logo-probe webgl2demo] onerror src=' + logoImage.src +
				' err=' + String((ev && ev.error && (ev.error.message || ev.error)) || ev));
		} catch (_) {}
	};
	logoImage.src = 'assets/logo.png';
	try {
		console.debug('[logo-probe webgl2demo] after assign logoImage.src=' + logoImage.src);
	} catch (_) {}

	// ----- Camera + input state -----
	let yaw = 0.0;
	let pitch = -0.035;
	let targetYaw = 0.0;
	let targetPitch = -0.035;
	let fov = 1.06;
	const targetFov = 1.06; // wheel zoom dropped — fov stays fixed.
	const mood = 1.0;
	const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

	// Drag-to-orbit, mirroring nxjs-webgl-demo's attach-everywhere pattern.
	let dragActive = false;
	let activeTouchId = null;
	let lastX = 0, lastY = 0;
	function startDrag(x, y) { dragActive = true; lastX = x; lastY = y; }
	function moveDrag(x, y) {
		if (!dragActive) return;
		const dx = x - lastX;
		const dy = y - lastY;
		lastX = x;
		lastY = y;
		targetYaw = clamp(targetYaw + dx * 0.0032, -0.78, 0.78);
		targetPitch = clamp(targetPitch - dy * 0.0024, -0.22, 0.18);
	}
	function endDrag() { dragActive = false; activeTouchId = null; }

	function onTouchStart(e) {
		const ct = e && e.changedTouches;
		if (ct && ct.length > 0 && activeTouchId === null) {
			const t = ct[0];
			activeTouchId = t.identifier;
			startDrag(t.clientX, t.clientY);
		}
	}
	function onTouchMove(e) {
		if (activeTouchId === null) return;
		const ct = e && e.changedTouches;
		if (!ct) return;
		for (let i = 0; i < ct.length; i++) {
			if (ct[i].identifier === activeTouchId) {
				moveDrag(ct[i].clientX, ct[i].clientY);
				return;
			}
		}
	}
	function onTouchEnd(e) {
		if (activeTouchId === null) return;
		const ct = e && e.changedTouches;
		if (!ct) return;
		for (let i = 0; i < ct.length; i++) {
			if (ct[i].identifier === activeTouchId) {
				endDrag();
				return;
			}
		}
	}

	function attachAll(name, fn) {
		const targets = [];
		if (typeof globalThis.screen !== 'undefined' && globalThis.screen && globalThis.screen.addEventListener)
			targets.push(globalThis.screen);
		if (typeof window !== 'undefined' && window.addEventListener) targets.push(window);
		if (typeof document !== 'undefined' && document.addEventListener) targets.push(document);
		if (canvas && canvas.addEventListener) targets.push(canvas);
		for (const t of targets) {
			try { t.addEventListener(name, fn); } catch (_) {}
		}
	}
	attachAll('touchstart', onTouchStart);
	attachAll('touchmove', onTouchMove);
	attachAll('touchend', onTouchEnd);
	attachAll('touchcancel', onTouchEnd);

	// Gamepad right-stick = orbit, mirroring nxjs-webgl-demo.
	function pollGamepad(dt) {
		const pads = (typeof navigator !== 'undefined' && navigator.getGamepads)
			? navigator.getGamepads() : null;
		if (!pads) return;
		const gp = pads[0];
		if (!gp) return;
		const dead = 0.12;
		const rx = gp.axes[2] || 0;
		const ry = gp.axes[3] || 0;
		if (Math.abs(rx) > dead) targetYaw = clamp(targetYaw + rx * dt * 1.6, -0.78, 0.78);
		if (Math.abs(ry) > dead) targetPitch = clamp(targetPitch - ry * dt * 0.6, -0.22, 0.18);
	}

	// ----- CPU-side cube pose, mirroring the GLSL cubePose() exactly. -----
	const CUBE_HALF_SIZE = 2.76;
	const ANCHOR_X = -8.2;
	const ANCHOR_Z = -10.5;
	const WAVE_DIRS = [
		[ 0.8645072,  0.5026205],
		[-0.3401361,  0.9403762],
		[ 0.0995037,  0.9950372],
		[ 0.9615239, -0.2747211],
	];
	function hash12CPU(x, y) {
		let px = (x * 0.1031) % 1; if (px < 0) px += 1;
		let py = (y * 0.1031) % 1; if (py < 0) py += 1;
		let pz = (x * 0.1031) % 1; if (pz < 0) pz += 1;
		const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
		px += d; py += d; pz += d;
		let r = ((px + py) * pz) % 1;
		if (r < 0) r += 1;
		return r;
	}
	function noiseCPU(x, y) {
		const ix = Math.floor(x), iy = Math.floor(y);
		const fx = x - ix, fy = y - iy;
		const ux = fx * fx * (3 - 2 * fx);
		const uy = fy * fy * (3 - 2 * fy);
		const a = hash12CPU(ix, iy);
		const b = hash12CPU(ix + 1, iy);
		const c = hash12CPU(ix, iy + 1);
		const d = hash12CPU(ix + 1, iy + 1);
		return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
	}
	function fbmCPU(x, y) {
		let f = 0, a = 0.52, px = x, py = y;
		for (let i = 0; i < 5; i++) {
			f += a * noiseCPU(px, py);
			const nx = 1.62 * px + 1.18 * py + 17.3;
			const ny = -1.18 * px + 1.62 * py + 17.3;
			px = nx; py = ny;
			a *= 0.48;
		}
		return f;
	}
	function waveHeightCPU(x, z, t) {
		let h = 0;
		h += 0.38 * Math.sin((x * WAVE_DIRS[0][0] + z * WAVE_DIRS[0][1]) * 0.090 + t * 0.82);
		h += 0.22 * Math.sin((x * WAVE_DIRS[1][0] + z * WAVE_DIRS[1][1]) * 0.155 + t * 1.18);
		h += 0.13 * Math.sin((x * WAVE_DIRS[2][0] + z * WAVE_DIRS[2][1]) * 0.290 + t * 1.75);
		h += 0.08 * Math.sin((x * WAVE_DIRS[3][0] + z * WAVE_DIRS[3][1]) * 0.520 + t * 2.15);
		h += (fbmCPU(x * 0.075 + t * 0.035, z * 0.075 - t * 0.018) - 0.5) * 0.20;
		return h;
	}
	const cubeCenterArr = new Float32Array(3);
	const cubeRArr = new Float32Array(9);
	const cubeInvRArr = new Float32Array(9);
	const tmpA = new Float32Array(9);
	const rY = new Float32Array(9);
	const rX = new Float32Array(9);
	const rZ = new Float32Array(9);
	function mat3Mul(out, a, b) {
		for (let c = 0; c < 3; c++) {
			for (let r = 0; r < 3; r++) {
				out[c * 3 + r] =
					a[0 * 3 + r] * b[c * 3 + 0] +
					a[1 * 3 + r] * b[c * 3 + 1] +
					a[2 * 3 + r] * b[c * 3 + 2];
			}
		}
	}
	function mat3Transpose(out, m) {
		out[0] = m[0]; out[1] = m[3]; out[2] = m[6];
		out[3] = m[1]; out[4] = m[4]; out[5] = m[7];
		out[6] = m[2]; out[7] = m[5]; out[8] = m[8];
	}
	function rotYCPU(out, a) {
		const s = Math.sin(a), c = Math.cos(a);
		out[0] = c; out[1] = 0; out[2] = s;
		out[3] = 0; out[4] = 1; out[5] = 0;
		out[6] = -s; out[7] = 0; out[8] = c;
	}
	function rotXCPU(out, a) {
		const s = Math.sin(a), c = Math.cos(a);
		out[0] = 1; out[1] = 0; out[2] = 0;
		out[3] = 0; out[4] = c; out[5] = -s;
		out[6] = 0; out[7] = s; out[8] = c;
	}
	function rotZCPU(out, a) {
		const s = Math.sin(a), c = Math.cos(a);
		out[0] = c; out[1] = -s; out[2] = 0;
		out[3] = s; out[4] = c;  out[5] = 0;
		out[6] = 0; out[7] = 0;  out[8] = 1;
	}
	function updateCubePose(t) {
		const seaBob = waveHeightCPU(ANCHOR_X, ANCHOR_Z, t);
		cubeCenterArr[0] = ANCHOR_X;
		cubeCenterArr[1] = seaBob + CUBE_HALF_SIZE * 0.33 + Math.sin(t * 0.72) * 0.10;
		cubeCenterArr[2] = ANCHOR_Z;
		const waveRoll = waveHeightCPU(ANCHOR_X + 2.0, ANCHOR_Z, t) - waveHeightCPU(ANCHOR_X - 2.0, ANCHOR_Z, t);
		const wavePitch = waveHeightCPU(ANCHOR_X, ANCHOR_Z + 2.0, t) - waveHeightCPU(ANCHOR_X, ANCHOR_Z - 2.0, t);
		rotYCPU(rY, t * 0.22);
		rotXCPU(rX, wavePitch * 0.22 + Math.sin(t * 0.52) * 0.05);
		rotZCPU(rZ, -waveRoll * 0.22);
		mat3Mul(tmpA, rY, rX);
		mat3Mul(cubeRArr, tmpA, rZ);
		mat3Transpose(cubeInvRArr, cubeRArr);
	}

	// ----- Constant per-program uniforms -----
	gl.viewport(0, 0, W, H);
	gl.uniform1f(U.mood, mood);

	// ----- Frame loop -----
	const start = performance.now();
	let lastNow = start;
	let fpsAccumStart = start;
	let fpsAccumFrames = 0;

	function frame(now) {
		const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) * 0.001));
		lastNow = now;
		pollGamepad(dt);
		yaw += (targetYaw - yaw) * 0.085;
		pitch += (targetPitch - pitch) * 0.085;
		fov += (targetFov - fov) * 0.075;

		const tSec = (now - start) * 0.001;
		updateCubePose(tSec);

		gl.uniform2f(U.res, W, H);
		gl.uniform1f(U.time, tSec);
		gl.uniform2f(U.look, yaw, pitch);
		gl.uniform1f(U.fov, fov);
		gl.uniform1i(U.logoReady, logoReady ? 1 : 0);
		gl.uniform3fv(U.cubeCenter, cubeCenterArr);
		gl.uniformMatrix3fv(U.cubeR, false, cubeRArr);
		gl.uniformMatrix3fv(U.cubeInvR, false, cubeInvRArr);

		// Clear stale error before draw so the post-draw error reflects
		// only this frame ([[bridge-stale-glerror]]).
		gl.getError();
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.getError();

		fpsAccumFrames++;
		if (now - fpsAccumStart >= 3000) {
			fpsAccumStart = now;
			fpsAccumFrames = 0;
		}
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);

} catch (_) {}
}
