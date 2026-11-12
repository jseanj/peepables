#!/usr/bin/env node
// Real-browser integration checks. Uses only Node built-ins and local Chrome.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const pagePath = process.argv[2];
if (!pagePath) throw new Error('Usage: node test_widget.mjs /absolute/path/index.html [screenshot.png]');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'peek-widget-check-'));
const browser = spawn(chromePath, ['--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-sync', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1280,1000', pathToFileURL(resolve(pagePath)).href], { stdio: 'ignore' });
let socket;
const pending = new Map();
let nextId = 0;
const delay = ms => new Promise(done => setTimeout(done, ms));
async function poll(fn, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { const result = await fn(); if (result) return result; } catch {} await delay(100); }
  throw new Error('Timed out waiting for browser state');
}
async function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function move(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await delay(420);
}
const snapshot = `Array.from(document.querySelectorAll('main .gallery > figure > :first-child')).map(host => ({
  eyes: Array.from(host.shadowRoot.querySelectorAll('[data-peek-eye]')).map(g => {
    const w=g.querySelector('[data-peek-white]'),p=g.querySelector('[data-peek-pupil]');
    const n=(e,a)=>Number(e.getAttribute(a));
    const wc=new DOMPoint(n(w,'cx'),n(w,'cy')).matrixTransform(g.getScreenCTM());
    const pc=new DOMPoint(n(p,'cx'),n(p,'cy')).matrixTransform(g.getScreenCTM());
    const k=Math.max(n(p,'rx')/n(w,'rx'),n(p,'ry')/n(w,'ry'));
    const bound=Math.hypot((n(p,'cx')-n(w,'cx'))/n(w,'rx'),(n(p,'cy')-n(w,'cy'))/n(w,'ry'))+k;
    return {dx:pc.x-wc.x,dy:pc.y-wc.y,bound,cx:wc.x,cy:wc.y};
  })
}))`;
try {
  const portText = await poll(async () => await readFile(join(profile, 'DevToolsActivePort'), 'utf8'));
  const port = Number(portText.split('\n')[0]);
  const target = await poll(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('file:')));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id); clearTimeout(request.timer);
    if (result.error) request.reject(new Error(JSON.stringify(result.error))); else request.done(result.result);
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await poll(() => evaluate(`!!document.querySelector('main .gallery > figure > :first-child')?.shadowRoot?.querySelector('[data-peek-pupil]')`));
  assert.equal(await evaluate(`document.querySelectorAll('main .gallery > figure > :first-child').length`), 2);
  await evaluate(`document.querySelectorAll('main .gallery > figure > :first-child').forEach(el=>{el.setAttribute('blink','off');el.removeAttribute('idle-ms')})`);
  await move(1190, 250);
  let state = await evaluate(snapshot);
  assert(state.every(host => host.eyes.every(eye => eye.dx > 0.2)), 'Both instances should look right');
  await move(5, 250);
  state = await evaluate(snapshot);
  assert(state.every(host => host.eyes.every(eye => eye.dx < -0.2)), 'Both instances should look left');
  console.log('PASS: same-page instances follow both directions at different sizes');

  await evaluate(`document.querySelector('main .gallery > figure > :first-child').style.transform='rotate(23deg) scale(.8)'`);
  for (const [x,y] of [[0,0],[1270,0],[1270,940],[0,940]]) {
    await move(x,y);
    state = await evaluate(snapshot);
    assert(state.every(host => host.eyes.every(eye => Number.isFinite(eye.dx) && eye.bound < 1)), 'Pupils must remain inside whites');
  }
  console.log('PASS: extreme directions, rotation and scaling preserve pupil containment');
  await evaluate(`document.querySelector('main .gallery > figure > :first-child').style.transform=''`);
  await evaluate('window.scrollTo(0,170)');
  await move(1180, 180);
  state = await evaluate(snapshot);
  assert(state.every(host => host.eyes.every(eye => eye.dx > 0.2)), 'Scroll tracking must use current coordinates');
  await cdp('Emulation.setDeviceMetricsOverride', {width:780,height:1000,deviceScaleFactor:1,mobile:false});
  await move(760, 160);
  state = await evaluate(snapshot);
  assert(state.every(host => host.eyes.every(eye => eye.dx > 0)), 'Resize tracking must use current coordinates');
  console.log('PASS: scrolling and viewport resize retain tracking direction');

  await cdp('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
  await move(700, 100);
  assert(await evaluate(`Array.from(document.querySelector('main .gallery > figure > :first-child').shadowRoot.querySelectorAll('[data-peek-lid]')).every(el=>el.getAttribute('transform').includes('scale(1 1)'))`));
  await evaluate(`document.querySelectorAll('main .gallery > figure > :first-child').forEach(el=>el.setAttribute('tracking','off'))`);
  await move(0, 0);
  state = await evaluate(snapshot);
  assert(state.every(host => host.eyes.every(eye => Math.hypot(eye.dx,eye.dy)<0.01)), 'Disabled tracking must center pupils');
  console.log('PASS: reduced motion and tracking=off');
  await cdp('Emulation.setEmulatedMedia', { features:[] });
  await evaluate(`document.querySelectorAll('main .gallery > figure > :first-child').forEach(el=>el.removeAttribute('tracking'))`);
  await evaluate(`document.querySelector('main .gallery > figure > :first-child').setAttribute('idle-ms','120')`);
  await delay(180);
  assert(await evaluate(`document.querySelector('main .gallery > figure > :first-child').shadowRoot.querySelector('[data-peek-lid]').getAttribute('transform').includes('scale(1 0.04)')`));
  await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',x:650,y:160});
  await delay(25);
  assert(await evaluate(`document.querySelector('main .gallery > figure > :first-child').shadowRoot.querySelector('[data-peek-lid]').getAttribute('transform').includes('scale(1 1)')`));
  await evaluate(`document.querySelector('main .gallery > figure > :first-child').removeAttribute('idle-ms')`);
  console.log('PASS: opt-in idle sleep and pointer wake');

  await evaluate(`window.originalRandom=Math.random;Math.random=()=>0;document.querySelector('main .gallery > figure > :first-child').removeAttribute('blink')`);
  await poll(() => evaluate(`document.querySelector('main .gallery > figure > :first-child').shadowRoot.querySelector('[data-peek-lid]').getAttribute('transform').includes('scale(1 0.04)')`),4000);
  await delay(180);
  assert(await evaluate(`document.querySelector('main .gallery > figure > :first-child').shadowRoot.querySelector('[data-peek-lid]').getAttribute('transform').includes('scale(1 1)')`));
  await evaluate(`Math.random=originalRandom;document.querySelector('main .gallery > figure > :first-child').setAttribute('blink','off');window.scrollTo(0,document.body.scrollHeight)`);
  await delay(220);
  assert(await evaluate(`!document.querySelector('main .gallery > figure > :first-child')._inView && document.querySelector('main .gallery > figure > :first-child')._raf===0`));
  await evaluate('window.scrollTo(0,0)');
  await delay(180);
  console.log('PASS: automatic blink reopens eyes; offscreen components pause');

  await evaluate(`window.removedWidget=document.querySelector('main .gallery > figure > :first-child');window.widgetParent=removedWidget.parentNode;removedWidget.remove()`);
  assert(await evaluate(`removedWidget._raf===0 && removedWidget._blinkTimer===null && removedWidget._openTimer===null && removedWidget._idleTimer===null`));
  await evaluate(`widgetParent.prepend(removedWidget)`);
  await move(740, 150);
  state=await evaluate(snapshot);
  assert(state[0].eyes.every(eye=>eye.dx>0), 'Reconnected component must track again');
  assert.equal(await evaluate(`removedWidget.shadowRoot.querySelectorAll('[data-peek-lid]').length`),2);
  console.log('PASS: removal stops timers; reconnection works without duplicate eye layers');

  await evaluate(`window.scrollTo(0,0);window.touchWasPrevented=false;document.addEventListener('touchmove',e=>{window.touchWasPrevented ||= e.defaultPrevented},{passive:true})`);
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:700,y:700}]});
  await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:700,y:500}]});
  await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await delay(250);
  assert.equal(await evaluate('window.touchWasPrevented'),false);
  assert(await evaluate('window.scrollY > 0'), 'Touch must still scroll the page');
  await evaluate(`document.querySelector('#demo-button').click()`);
  assert(await evaluate(`document.querySelector('#demo-button').textContent.includes('正常使用')`));
  console.log('PASS: touch scroll and host-page buttons remain usable');

  await cdp('Emulation.clearDeviceMetricsOverride');
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});
  // A fresh document avoids touch-scroll momentum contaminating the screenshot.
  await cdp('Page.navigate',{url:pathToFileURL(resolve(pagePath)).href+'?preview=1'});
  await poll(() => evaluate(`location.search==='?preview=1' && !!document.querySelector('main .gallery > figure > :first-child')?.shadowRoot?.querySelector('[data-peek-pupil]')`));
  await evaluate('window.scrollTo(0,0)');
  await move(1100, 200);
  if (process.argv[3]) {
    const screenshot=await cdp('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(process.argv[3]),Buffer.from(screenshot.data,'base64'));
  }
  console.log('All browser integration checks passed.');
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await new Promise(done=>{if(browser.exitCode!==null)done();else{browser.once('exit',done);setTimeout(()=>{browser.kill('SIGKILL');done()},2000).unref()}});
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
