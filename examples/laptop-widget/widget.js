/* Self-contained Peeking Eyes Doodle widget; generated from editable SVG. */
(() => {
  const tagName = "peek-laptop";
  const artwork = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"1024\" viewBox=\"0 0 1024 1024\" fill=\"none\" stroke=\"#000000\" stroke-width=\"16\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <title>Peeking Eyes Doodle \u2014 laptop</title>\n  <desc>A white open laptop with a pair of eyes peeking left from the dark lower edge inside its screen.</desc>\n  <g id=\"screen\">\n    <path fill=\"#FFFFFF\" d=\"M252 204 Q248 187 271 185 L775 197 Q795 198 795 220 L772 627 L235 618 Z\"/>\n    <path fill=\"#FFFFFF\" d=\"M281 233 Q280 226 292 227 L751 238 Q758 238 757 252 L738 577 L268 569 Z\"/>\n    <path id=\"screen-recess\" fill=\"#000000\" stroke=\"none\" d=\"M272 508 Q354 497 428 514 Q487 518 543 504 Q614 492 675 506 Q711 514 742 502 L738 577 L268 569 Z\"/>\n    <g id=\"eyes\" stroke=\"none\">\n      <g data-peek-eye=\"\" transform=\"rotate(-5 460 542)\">\n        <ellipse data-peek-white=\"\" id=\"left-eye-white\" fill=\"#FFFFFF\" cx=\"460\" cy=\"542\" rx=\"21\" ry=\"22\"/>\n        <ellipse data-peek-pupil=\"\" id=\"left-pupil\" fill=\"#000000\" cx=\"452\" cy=\"544\" rx=\"8\" ry=\"10\"/>\n      </g>\n      <g data-peek-eye=\"\" transform=\"rotate(5 524 542)\">\n        <ellipse data-peek-white=\"\" id=\"right-eye-white\" fill=\"#FFFFFF\" cx=\"524\" cy=\"542\" rx=\"21\" ry=\"22\"/>\n        <ellipse data-peek-pupil=\"\" id=\"right-pupil\" fill=\"#000000\" cx=\"516\" cy=\"544\" rx=\"8\" ry=\"10\"/>\n      </g>\n    </g>\n    <path d=\"M268 569 L738 577\"/>\n  </g>\n  <g id=\"base\">\n    <path fill=\"#FFFFFF\" d=\"M235 618 L772 627 L871 788 Q879 800 858 804 L165 800 Q145 798 154 782 Z\"/>\n    <path fill=\"#FFFFFF\" d=\"M154 787 Q191 793 238 791 L871 792 L865 817 Q862 837 834 837 L190 832 Q166 831 161 815 Z\"/>\n    <g id=\"keyboard\" stroke-width=\"10\">\n      <path d=\"M290 655 L727 663 M274 686 L746 693 M254 720 L766 727\"/>\n      <path d=\"M342 657 L326 719 M412 658 L403 722 M483 659 L480 723 M554 660 L558 724 M625 662 L636 725 M693 663 L713 726\"/>\n    </g>\n    <path id=\"trackpad\" stroke-width=\"10\" d=\"M437 747 Q486 745 572 749 L586 775 L422 772 Z\"/>\n  </g>\n</svg>";
  const defaultLabel = "黑白偷看笔记本电脑";
  if (customElements.get(tagName)) return;

  class PeekingDoodle extends HTMLElement {
    static get observedAttributes() { return ['label', 'tracking', 'blink', 'idle-ms']; }

    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host { display:inline-block; width:var(--peeking-size,240px); max-width:100%; vertical-align:middle; line-height:0; }
        svg { display:block; width:100%; height:auto; overflow:visible; pointer-events:none; }
      </style>${artwork}`;
      this._svg = shadow.querySelector('svg');
      this._svg.setAttribute('aria-hidden', 'true');
      this._eyes = [...shadow.querySelectorAll('[data-peek-eye]')].map(group => {
        const white = group.querySelector('[data-peek-white]');
        const pupil = group.querySelector('[data-peek-pupil]');
        const number = (el, attr) => Number(el.getAttribute(attr));
        const cx = number(white, 'cx'), cy = number(white, 'cy');
        const rx = number(white, 'rx'), ry = number(white, 'ry');
        const ratio = Math.max(number(pupil, 'rx') / rx, number(pupil, 'ry') / ry);
        // Conservative inner ellipse: pupil + offset remains inside the eye.
        const factor = Math.max(0, 1 - ratio - 0.08);
        const lid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        lid.setAttribute('data-peek-lid', '');
        while (group.firstChild) lid.append(group.firstChild);
        group.append(lid);
        pupil.setAttribute('cx', cx);
        pupil.setAttribute('cy', cy);
        return { group, pupil, lid, cx, cy, a: rx * factor, b: ry * factor, x: 0, y: 0 };
      });
      this._raf = 0;
      this._blinkTimer = this._openTimer = this._idleTimer = null;
      this._pointer = null;
      this._sleeping = false;
      this._inView = true;
    }

    connectedCallback() {
      this._abort?.abort();
      this._abort = new AbortController();
      const options = { passive: true, signal: this._abort.signal };
      this._motion = matchMedia('(prefers-reduced-motion: reduce)');
      this._inView = true;
      this._lastTime = 0;
      this._applyLabel();
      const move = event => {
        if (this.getAttribute('tracking') === 'off') return;
        this._pointer = { x: event.clientX, y: event.clientY };
        this._wake();
        this._requestFrame();
      };
      window.addEventListener('pointermove', move, options);
      window.addEventListener('pointerdown', move, options);
      window.addEventListener('pointerout', event => { if (!event.relatedTarget) this._reset(); }, options);
      window.addEventListener('blur', () => this._reset(), options);
      window.addEventListener('scroll', () => this._requestFrame(), { ...options, capture: true });
      window.addEventListener('resize', () => this._requestFrame(), options);
      document.addEventListener('visibilitychange', () => this._refreshActivity(), options);
      this._motion.addEventListener('change', () => this._refreshActivity(), options);
      this._resize = new ResizeObserver(() => this._requestFrame());
      this._resize.observe(this);
      this._intersection = new IntersectionObserver(entries => {
        this._inView = entries[0].isIntersecting;
        this._refreshActivity();
      });
      this._intersection.observe(this);
      this._refreshActivity();
    }

    disconnectedCallback() {
      this._abort?.abort();
      this._resize?.disconnect();
      this._intersection?.disconnect();
      this._stop();
      this._pointer = null;
      this._sleeping = false;
      this._setLid(1);
      this._eyes.forEach(eye => {
        eye.x = eye.y = 0;
        eye.pupil.setAttribute('cx', eye.cx);
        eye.pupil.setAttribute('cy', eye.cy);
      });
    }

    attributeChangedCallback(name) {
      if (!this.isConnected) return;
      if (name === 'label') this._applyLabel();
      else {
        if (name === 'tracking') this._reset();
        this._refreshActivity();
      }
    }

    _applyLabel() {
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', this.getAttribute('label') || defaultLabel);
    }
    _active() { return this.isConnected && this._inView && !document.hidden; }
    _setLid(scale) {
      this._eyes.forEach(eye => eye.lid.setAttribute('transform',
        `translate(${eye.cx} ${eye.cy}) scale(1 ${scale}) translate(${-eye.cx} ${-eye.cy})`));
    }
    _stop() {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      for (const key of ['_blinkTimer', '_openTimer', '_idleTimer']) {
        clearTimeout(this[key]);
        this[key] = null;
      }
    }
    _refreshActivity() {
      this._stop();
      this._sleeping = false;
      this._setLid(1);
      if (!this._active()) return;
      this._wake();
      this._requestFrame();
    }
    _wake() {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
      if (this._sleeping) { this._sleeping = false; this._setLid(1); }
      const idle = Number(this.getAttribute('idle-ms'));
      if (this._active() && !this._motion.matches && Number.isFinite(idle) && idle > 0) {
        this._idleTimer = setTimeout(() => {
          this._idleTimer = null;
          this._sleeping = true;
          clearTimeout(this._openTimer);
          this._openTimer = null;
          this._setLid(0.04);
        }, idle);
      }
      this._scheduleBlink();
    }
    _scheduleBlink() {
      if (this._blinkTimer !== null || !this._active() || this._motion.matches || this.getAttribute('blink') === 'off') return;
      this._blinkTimer = setTimeout(() => {
        this._blinkTimer = null;
        if (!this._sleeping) {
          this._setLid(0.04);
          this._openTimer = setTimeout(() => {
            this._openTimer = null;
            if (!this._sleeping) this._setLid(1);
          }, 130);
        }
        this._scheduleBlink();
      }, 2400 + Math.random() * 4000);
    }
    _reset() {
      this._pointer = null;
      this._wake();
      this._requestFrame();
    }
    _requestFrame() {
      if (!this._raf && this._active()) this._raf = requestAnimationFrame(time => this._tick(time));
    }
    _tick(time) {
      this._raf = 0;
      if (!this._active()) return;
      const matrices = this._eyes.map(eye => eye.group.getScreenCTM());
      if (matrices.some(matrix => !matrix || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-10)) return;
      const centers = this._eyes.map((eye, index) => new DOMPoint(eye.cx, eye.cy).matrixTransform(matrices[index]));
      const center = centers.reduce((sum, point) => ({ x: sum.x + point.x / centers.length, y: sum.y + point.y / centers.length }), { x: 0, y: 0 });
      const pointer = this.getAttribute('tracking') === 'off' ? null : this._pointer;
      const dx = pointer ? pointer.x - center.x : 0;
      const dy = pointer ? pointer.y - center.y : 0;
      const strength = Math.min(1, Math.hypot(dx, dy) / 140);
      const dt = this._lastTime ? Math.min(64, time - this._lastTime) : 16;
      this._lastTime = time;
      const ease = this._motion.matches ? 1 : 1 - Math.exp(-dt / 55);
      let unsettled = false;
      this._eyes.forEach((eye, index) => {
        const inverse = matrices[index].inverse();
        const vectorX = inverse.a * dx + inverse.c * dy;
        const vectorY = inverse.b * dx + inverse.d * dy;
        const length = eye.a && eye.b ? Math.hypot(vectorX / eye.a, vectorY / eye.b) : 0;
        const tx = length ? vectorX / length * strength : 0;
        const ty = length ? vectorY / length * strength : 0;
        eye.x += (tx - eye.x) * ease;
        eye.y += (ty - eye.y) * ease;
        if (Math.hypot(tx - eye.x, ty - eye.y) > 0.01) unsettled = true;
        else { eye.x = tx; eye.y = ty; }
        eye.pupil.setAttribute('cx', (eye.cx + eye.x).toFixed(4));
        eye.pupil.setAttribute('cy', (eye.cy + eye.y).toFixed(4));
      });
      if (unsettled) this._requestFrame();
      else this._lastTime = 0;
    }
  }
  customElements.define(tagName, PeekingDoodle);
})();
