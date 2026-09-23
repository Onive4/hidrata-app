/* Efeitos de interação do Hidrata (sem bibliotecas).
   Regras para ficar liso no celular: só anima transform e opacity (não mexe no layout), usa a Web Animations API
   (roda fora da thread principal), limita quantas partículas existem ao mesmo tempo e respeita "reduzir movimento". */

const FX = (() => {
  const MAX_PARTICLES = 60;
  const stats = { spawned: 0, live: 0, peak: 0 };
  const CONFETTI_COLORS = ["#14b8a6", "#5eead4", "#fbbf24", "#a78bfa", "#f87171"];
  let layer = null;

  function on() {
    return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function buzz(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch {}
  }
  function getLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.id = "g-fx";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  }
  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  const rand = (min, max) => min + Math.random() * (max - min);

  // cria uma partícula na camada de efeitos e a anima; devolve a animação (ou null se não pode)
  function spawn(content, x, y, frames, opts) {
    if (!on() || stats.live >= MAX_PARTICLES) return null;
    const p = document.createElement("span");
    p.className = "g-particle" + (opts.cls ? " " + opts.cls : "");
    if (content instanceof Node) p.appendChild(content);
    else if (content) p.textContent = content;
    p.style.left = x + "px";
    p.style.top = y + "px";
    if (opts.size) p.style.fontSize = opts.size + "px";
    if (opts.bg) p.style.background = opts.bg;
    getLayer().appendChild(p);
    stats.spawned++;
    stats.live++;
    if (stats.live > stats.peak) stats.peak = stats.live;
    const anim = p.animate(frames, { duration: opts.ms, delay: opts.delay || 0, easing: opts.easing || "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      p.remove();
      stats.live--;
      if (opts.onDone) opts.onDone();
    };
    anim.onfinish = done;
    anim.oncancel = done;
    return anim;
  }

  // explosão de emojis saindo de um ponto
  function burst(x, y, glyphs, count, opts) {
    const o = Object.assign({ spread: 90, size: 20, ms: 900 }, opts);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rand(-0.4, 0.4);
      const dist = rand(o.spread * 0.45, o.spread);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 24;
      const rot = rand(-50, 50);
      const g = Array.isArray(glyphs) ? glyphs[i % glyphs.length] : glyphs;
      spawn(g, x, y, [
        { transform: "translate(-50%,-50%) scale(.3)", opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.75}px), calc(-50% + ${dy * 0.75}px)) scale(1.15) rotate(${rot}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 36}px)) scale(.7) rotate(${rot * 1.6}deg)`, opacity: 0 },
      ], { size: o.size * rand(0.8, 1.25), ms: o.ms * rand(0.85, 1.15), delay: i * 12 });
    }
  }

  // um emoji que voa em arco de um elemento até outro
  function fly(fromEl, toEl, glyph, opts) {
    const o = Object.assign({ ms: 650, arc: 70, size: 24, onArrive: null }, opts);
    if (!on() || !fromEl || !toEl || !fromEl.isConnected || !toEl.isConnected) {
      if (o.onArrive) o.onArrive();
      return;
    }
    const a = center(fromEl);
    const b = center(toEl);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const anim = spawn(glyph, a.x, a.y, [
      { transform: "translate(-50%,-50%) scale(.6) rotate(0deg)", opacity: 0.9 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - o.arc}px)) scale(1.4) rotate(-14deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.85) rotate(8deg)`, opacity: 1 },
    ], { size: o.size, ms: o.ms, easing: "cubic-bezier(.45,.05,.35,1)", onDone: o.onArrive });
    if (!anim && o.onArrive) o.onArrive();
  }

  // chuva de confete (cai do topo da tela)
  function confetti(count) {
    const n = Math.min(count || 26, 40);
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    for (let i = 0; i < n; i++) {
      const x = rand(0, w);
      const drift = rand(-80, 80);
      const rot = rand(300, 900) * (Math.random() < 0.5 ? -1 : 1);
      spawn(null, x, -16, [
        { transform: "translate(-50%,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${drift}px), ${hgt * 0.55}px) rotate(${rot * 0.55}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${drift * 1.4}px), ${hgt + 20}px) rotate(${rot}deg)`, opacity: 0.85 },
      ], { cls: "g-confetti", bg: CONFETTI_COLORS[i % CONFETTI_COLORS.length], ms: rand(1400, 2400), delay: rand(0, 350), easing: "cubic-bezier(.3,.6,.5,1)" });
    }
  }

  // onda que sai do toque (o elemento precisa ser position:relative com overflow:hidden)
  function ripple(el, ev) {
    if (!on() || !el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const x = (ev && ev.clientX ? ev.clientX : r.left + r.width / 2) - r.left;
    const y = (ev && ev.clientY ? ev.clientY : r.top + r.height / 2) - r.top;
    const d = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement("span");
    s.className = "g-ripple";
    s.style.width = s.style.height = d + "px";
    s.style.left = x - d / 2 + "px";
    s.style.top = y - d / 2 + "px";
    el.appendChild(s);
    s.animate([{ transform: "scale(0)", opacity: 0.4 }, { transform: "scale(1)", opacity: 0 }], { duration: 560, easing: "ease-out" }).onfinish = () => s.remove();
  }

  // anel que se expande em volta de um elemento (avatar, botão)
  function ring(el, color) {
    if (!on() || !el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const c = center(el);
    const ringEl = document.createElement("span");
    ringEl.className = "g-ring";
    ringEl.style.width = ringEl.style.height = Math.max(r.width, r.height) + "px";
    if (color) ringEl.style.borderColor = color;
    spawn(ringEl, c.x, c.y, [
      { transform: "translate(-50%,-50%) scale(.9)", opacity: 0.85 },
      { transform: "translate(-50%,-50%) scale(2.1)", opacity: 0 },
    ], { ms: 650, easing: "ease-out" });
  }

  const wiggle = (el, frames, ms, easing) => (on() && el && el.isConnected ? el.animate(frames, { duration: ms, easing: easing || "ease-out" }) : null);
  const pulse = (el) => wiggle(el, [{ transform: "scale(1)" }, { transform: "scale(1.22)" }, { transform: "scale(1)" }], 420, "cubic-bezier(.34,1.56,.64,1)");
  const bounce = (el) => wiggle(el, [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-8px) scale(1.12)" }, { transform: "translateY(0) scale(.96)" }, { transform: "translateY(0) scale(1)" }], 520, "cubic-bezier(.34,1.56,.64,1)");
  const shake = (el) => wiggle(el, [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], 380);
  // "cutucada" recebida: o avatar balança como se tivesse levado um toque
  const nudge = (el) => wiggle(el, [{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(-14deg) scale(1.15)" }, { transform: "rotate(12deg) scale(1.1)" }, { transform: "rotate(-8deg)" }, { transform: "rotate(4deg)" }, { transform: "rotate(0deg) scale(1)" }], 600, "ease-in-out");

  // número que sobe/desce contando (troca só o texto; dura pouco)
  function count(el, from, to, ms, format) {
    const fmt = format || ((v) => String(v));
    if (!on() || from === to || !el) {
      if (el) el.textContent = fmt(to);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(step);
  }

  // gota que cai reta de cima até um ponto (ex.: caindo dentro da Jarra)
  function drop(x, y0, y1, delay) {
    const dy = y1 - y0;
    spawn("💧", x, y0, [
      { transform: "translate(-50%,-50%) scale(.7)", opacity: 0 },
      { transform: `translate(-50%, calc(-50% + ${dy * 0.12}px)) scale(1)`, opacity: 1, offset: 0.15 },
      { transform: `translate(-50%, calc(-50% + ${dy}px)) scale(.6)`, opacity: 0.9 },
    ], { size: 20, ms: 640, delay: delay || 0, easing: "cubic-bezier(.5,0,.9,.6)" });
  }

  // balãozinho que sobe e some no rodapé (reações recebidas)
  function bubble(text, delay) {
    if (!on()) return;
    const b = document.createElement("div");
    b.className = "g-bubble";
    b.textContent = text;
    b.style.opacity = "0";
    getLayer().appendChild(b);
    const anim = b.animate([
      { transform: "translate(-50%, 24px) scale(.85)", opacity: 0 },
      { transform: "translate(-50%, 0) scale(1.04)", opacity: 1, offset: 0.14 },
      { transform: "translate(-50%, -6px) scale(1)", opacity: 1, offset: 0.78 },
      { transform: "translate(-50%, -34px) scale(.96)", opacity: 0 },
    ], { duration: 3200, delay: delay || 0, easing: "ease-out", fill: "forwards" });
    anim.onfinish = anim.oncancel = () => b.remove();
  }

  return { on, buzz, center, burst, fly, drop, confetti, ripple, ring, pulse, bounce, shake, nudge, count, bubble, stats };
})();
