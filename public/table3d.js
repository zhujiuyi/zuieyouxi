import * as THREE from './vendor/three.module.js';
import { META, card } from '/shared/cards.mjs';
import { artUrl } from './art.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const roundedRect = (ctx, x, y, width, height, radius) => { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); };
function feltTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#423149'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 18000; i++) {
    const grey = 70 + Math.random() * 60; ctx.fillStyle = `rgba(${grey},${grey * .7},${grey * 1.1},${Math.random() * .14})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 2);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(7, 7); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function backTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 1088;
  const c = canvas.getContext('2d');
  c.scale(2, 2);
  c.fillStyle = '#e2d6c4'; roundedRect(c, 0, 0, 384, 544, 23); c.fill();
  c.fillStyle = '#38283e'; roundedRect(c, 13, 13, 358, 518, 15); c.fill();
  c.strokeStyle = '#a48a65'; c.lineWidth = 2; roundedRect(c, 25, 25, 334, 494, 9); c.stroke();
  c.save(); c.beginPath(); c.rect(29, 29, 326, 486); c.clip();
  c.strokeStyle = '#80634433'; c.lineWidth = 1;
  for (let i = -550; i < 1000; i += 24) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 544, 544); c.stroke(); c.beginPath(); c.moveTo(i, 0); c.lineTo(i - 544, 544); c.stroke(); }
  c.restore();
  c.translate(192, 264); c.rotate(-.22); c.strokeStyle = '#ddbe86'; c.lineWidth = 8; c.beginPath(); c.ellipse(0, -55, 62, 22, 0, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 2; c.beginPath(); c.moveTo(0, -12); c.lineTo(48, 43); c.lineTo(0, 105); c.lineTo(-48, 43); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(0, -5); c.lineTo(0, 98); c.stroke();
  c.rotate(.22); c.fillStyle = '#cdb48c'; c.textAlign = 'center'; c.font = '17px Georgia'; c.fillText('THE DEADLIES', 0, 168);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function faceTexture(id, art) {
  const item = card(id), meta = META[item.suit];
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 1088;
  const c = canvas.getContext('2d');
  c.scale(2, 2); c.imageSmoothingQuality = 'high';
  c.fillStyle = '#e8dfcd'; roundedRect(c, 0, 0, 384, 544, 21); c.fill();
  c.save(); roundedRect(c, 15, 15, 354, 514, 11); c.clip();
  c.fillStyle = meta.color; c.fillRect(15, 15, 354, 514);
  if (art) {
    const scale = Math.max(354 / art.width, 340 / art.height);
    const width = 354 / scale, height = 340 / scale;
    c.drawImage(art, (art.width - width) / 2, (art.height - height) / 2, width, height, 15, 38, 354, 340);
  }
  c.fillStyle = '#eee5d1'; c.beginPath(); c.moveTo(15, 397); c.lineTo(52, 359); c.lineTo(332, 359); c.lineTo(369, 397); c.lineTo(369, 529); c.lineTo(15, 529); c.closePath(); c.fill();
  c.strokeStyle = meta.color; c.lineWidth = 3; c.stroke();
  c.fillStyle = '#f9f1dd'; c.shadowColor = '#24162e'; c.shadowBlur = 4; c.font = 'bold 69px Georgia'; c.textAlign = 'left'; c.fillText(item.value ?? '◎', 28, 88);
  c.font = 'bold 27px SimSun,serif'; c.textAlign = 'right'; c.fillText(meta.name, 347, 60); c.shadowBlur = 0;
  c.fillStyle = '#49394d'; c.textAlign = 'center'; c.font = 'bold 20px SimSun,serif';
  const text = meta.short, midway = text.indexOf('，');
  const lines = midway >= 0 ? [text.slice(0, midway), text.slice(midway + 1)] : [text];
  lines.forEach((line, i) => c.fillText(line, 192, 410 + i * 31));
  c.fillStyle = '#907c83'; c.font = '13px Georgia'; c.fillText(meta.english, 192, 493);
  c.restore();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function shape(width, height, radius) {
  const x = -width / 2, y = -height / 2, s = new THREE.Shape();
  s.moveTo(x + radius, y); s.lineTo(x + width - radius, y); s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius); s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height); s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius); s.quadraticCurveTo(x, y, x + radius, y); return s;
}
export class TableScene {
  constructor(container) {
    this.container = container; this.scene = new THREE.Scene(); this.pointer = new THREE.Vector2();
    this.materials = new Map(); this.textures = new Map(); this.cards = new THREE.Group(); this.scene.add(this.cards);
    this.mode = null; this.signature = ''; this.startTime = performance.now(); this.active = true; this.frames = 0;
    this.animations = []; this.width = 0; this.height = 0;
  }
  async init() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 650 ? 1.35 : 1.7));
    this.renderer.shadowMap.enabled = innerWidth >= 650; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.45;
    this.renderer.domElement.setAttribute('aria-label', '立体牌桌：抽牌堆、弃牌堆与光环'); this.renderer.domElement.setAttribute('role', 'img');
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); this.contextLost = true; this.container.classList.remove('loaded'); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.container.classList.add('loaded'); });
    this.camera = new THREE.PerspectiveCamera(41, 1, .1, 100);
    this.camera.position.set(0, 7.6, 9.8); this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight('#c2a7cc', 1.45));
    const light = new THREE.DirectionalLight('#ffe4b2', 3.1); light.position.set(-3, 9, 5); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = -9; light.shadow.camera.right = 9; light.shadow.camera.top = 8; light.shadow.camera.bottom = -8;
    light.shadow.normalBias = .025; light.shadow.bias = -.0002; this.scene.add(light);
    const violet = new THREE.PointLight('#a574d8', 24, 22); violet.position.set(4, 4, -4); this.scene.add(violet);
    this.felt = feltTexture(); this.back = backTexture();
    this.auraGeometry = new THREE.TorusGeometry(.81, .018, 8, 64);
    this.auraMaterial = new THREE.MeshBasicMaterial({ color: '#c6a966', transparent: true, opacity: .4 });
    this.paper = new THREE.MeshStandardMaterial({ color: '#d6ccb8', roughness: .9, metalness: 0 });
    this.cardGeometry = new THREE.ExtrudeGeometry(shape(1.18, 1.72, .065), { depth: .018, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .009, bevelThickness: .008 });
    this.cardGeometry.rotateX(-Math.PI / 2);
    this.faceGeometry = new THREE.PlaneGeometry(1.17, 1.71); this.faceGeometry.rotateX(-Math.PI / 2);
    this.table = new THREE.Group(); this.scene.add(this.table);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.16, .32, 96), new THREE.MeshStandardMaterial({ color: '#241b26', roughness: .43, metalness: .08 }));
    base.position.y = -.31; base.scale.set(1.4, 1, .81); base.receiveShadow = true; this.table.add(base);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(4.23, 4.23, .085, 96), new THREE.MeshStandardMaterial({ color: '#83653e', metalness: .68, roughness: .46 }));
    rim.position.y = -.125; rim.scale.set(1.4, 1, .81); this.table.add(rim);
    const leather = new THREE.Mesh(new THREE.CylinderGeometry(4.16, 4.16, .14, 96), new THREE.MeshStandardMaterial({ color: '#2b1e2b', roughness: .75 }));
    leather.position.y = -.09; leather.scale.set(1.4, 1, .81); leather.receiveShadow = true; this.table.add(leather);
    const surface = new THREE.Mesh(new THREE.CylinderGeometry(3.94, 3.94, .035, 96), new THREE.MeshStandardMaterial({ map: this.felt, color: '#c3b0c8', roughness: 1 }));
    surface.position.y = .0; surface.scale.set(1.4, 1, .81); surface.receiveShadow = true; this.table.add(surface);
    const thread = new THREE.Mesh(new THREE.TorusGeometry(4.03, .012, 6, 100), new THREE.MeshStandardMaterial({ color: '#806144', roughness: 1 }));
    thread.rotation.x = -Math.PI / 2; thread.scale.set(1.4, .81, 1); thread.position.y = .005; this.table.add(thread);
    const emblemCanvas = document.createElement('canvas'); emblemCanvas.width = 768; emblemCanvas.height = 256;
    const ctx = emblemCanvas.getContext('2d'); ctx.textAlign = 'center'; ctx.fillStyle = '#d6b98b40'; ctx.font = '22px Georgia'; ctx.fillText('T H E   D E A D L I E S', 384, 115); ctx.font = '13px Georgia'; ctx.fillText('◇     R E D E M P T I O N   J O U R N E Y     ◇', 384, 155);
    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(emblemCanvas), transparent: true, depthWrite: false }));
    emblem.rotation.x = -Math.PI / 2; emblem.position.set(0, .024, -1.75); this.table.add(emblem);
    this.art = Object.fromEntries(await Promise.all(Object.keys(META).map(async suit => {
      const image = new Image(); image.src = artUrl(suit);
      try { await image.decode(); return [suit, image]; } catch { return [suit, null]; }
    })));
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.container);
    this.container.addEventListener('pointermove', event => {
      const rect = this.container.getBoundingClientRect(); this.pointer.set((event.clientX - rect.left) / rect.width - .5, (event.clientY - rect.top) / rect.height - .5);
    });
    this.container.addEventListener('pointerleave', () => this.pointer.set(0, 0));
    this.visibility = () => { this.active = !document.hidden; }; document.addEventListener('visibilitychange', this.visibility);
    this.resize(); this.renderer.setAnimationLoop(time => this.frame(time));
  }
  resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height || !this.renderer) return;
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height;
    this.camera.fov = width < 450 ? 48 : 41; this.camera.updateProjectionMatrix();
  }
  material(id) {
    if (this.materials.has(id || 'back')) return this.materials.get(id || 'back');
    const texture = id ? faceTexture(id, this.art[card(id).suit]) : this.back;
    texture.anisotropy = Math.max(1, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    if (id) this.textures.set(id, texture);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .64, metalness: .01, transparent: true, alphaTest: .3 });
    this.materials.set(id || 'back', material); return material;
  }
  makeCard(id, x, y, z, angle = 0, scale = 1) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.cardGeometry, this.paper); body.castShadow = true; body.receiveShadow = true; group.add(body);
    const face = new THREE.Mesh(this.faceGeometry, this.material(id)); face.position.y = .034; face.receiveShadow = true; group.add(face);
    group.position.set(x, y, z); group.rotation.y = angle; group.scale.setScalar(scale);
    this.cards.add(group); return group;
  }
  pile(count, x, z, front = null) {
    const visible = Math.min(count, 24);
    for (let i = 0; i < visible; i++) this.makeCard(i === visible - 1 ? front : null, x + Math.sin(i * 7) * .012, .035 + i * .023, z + Math.cos(i * 5) * .008, Math.sin(i * 2) * .009);
  }
  update(room, mode) {
    const signature = mode === 'hero' ? 'hero' : `${mode}:${room?.turnNo}:${room?.deckCount}:${room?.discardCount}:${room?.haloAvailable}:${room?.pending?.type}:${room?.pending?.dealt?.length || 0}:${room?.lastPlay?.cards.join()}`;
    if (this.signature === signature) { this.resize(); return; }
    const previous = this.signature, previousMode = this.mode; this.signature = signature; this.mode = mode;
    while (this.cards.children.length) this.cards.remove(this.cards.children[0]);
    this.animations = [];
    if (mode === 'hero') {
      this.table.scale.set(.88, 1, .9); this.table.rotation.y = -.04;
      ['wrath-6', 'greed-3', 'pride-7', 'lust-5', 'purity'].forEach((id, i) => {
        const offset = i - 2;
        const c = this.makeCard(id, offset * .79, .18 + i * .055, Math.abs(offset) * .16, -offset * .2, 1.35);
        c.rotation.x = -.17; this.animations.push({ object: c, targetY: c.position.y, start: performance.now() + i * 65, lift: .75 });
      });
      this.pile(20, -3.12, .72); this.pile(7, 3.18, .5, 'gluttony-2');
    } else if (room) {
      this.table.scale.set(1, 1, 1); this.table.rotation.y = 0;
      this.pile(room.deckCount, -2.35, .1);
      const top = room.lastPlay?.cards.at(-1);
      this.pile(room.discardCount, 0, .1, room.discardTop);
      if (room.haloAvailable) {
        this.haloCard = this.makeCard('halo', 2.35, .055, .1, -.06);
        const aura = new THREE.Mesh(this.auraGeometry, this.auraMaterial);
        aura.rotation.x = -Math.PI / 2; aura.scale.set(1, 1.22, 1); aura.position.set(2.35, .025, .1); this.cards.add(aura);
      }
      if (room.table.length) {
        room.table.slice(-7).forEach((id, i) => {
          const c = this.makeCard(id, (i - Math.min(room.table.length, 7) / 2) * .12, .65 + i * .024, .2, i * .08);
          if (previousMode === 'board' && previous !== signature) this.animations.push({ object: c, targetY: c.position.y, start: performance.now() + i * 40, lift: 1 });
        });
      } else if (top && previousMode === 'board' && room.lastPlay) {
        const played = this.cards.children.filter(c => c.type === 'Group');
        const center = played.filter(c => Math.abs(c.position.x) < .3).at(-1);
        if (center) this.animations.push({ object: center, targetY: center.position.y, start: performance.now(), lift: .85 });
      }
      if (room.pending?.type === 'greed') room.pending.dealt.forEach((d, i) => this.makeCard(d.card, (i - 2) * .9, .055 + i * .012, 1.65, (i - 2) * .08, .72));
    }
    // Keep higher-resolution textures only for cards still visible on the table.
    const visibleMaterials = new Set();
    this.cards.traverse(object => { if (object.material) visibleMaterials.add(object.material); });
    for (const [id, material] of this.materials) {
      if (id === 'back' || visibleMaterials.has(material)) continue;
      material.dispose(); this.textures.get(id)?.dispose();
      this.materials.delete(id); this.textures.delete(id);
    }
    this.resize();
  }
  frame(time) {
    if (!this.active || this.contextLost || !this.container.isConnected || !this.width) return;
    // A 30 fps cap keeps an otherwise mostly still tabletop inexpensive.
    if (time - (this.lastFrame || 0) < 32) return;
    this.lastFrame = time; this.frames++;
    const cameraY = this.mode === 'hero' ? 7.4 : 7.9, cameraZ = this.mode === 'hero' ? 9.6 : 9.5;
    this.camera.position.x += ((reducedMotion ? 0 : this.pointer.x * .5) - this.camera.position.x) * .055;
    this.camera.position.y += (cameraY + (reducedMotion ? 0 : this.pointer.y * .18) - this.camera.position.y) * .055;
    this.camera.position.z += (cameraZ - this.camera.position.z) * .055;
    this.camera.lookAt(0, 0, .15);
    for (const animation of this.animations) {
      const t = reducedMotion ? 1 : Math.max(0, Math.min(1, (time - animation.start) / 650));
      const easing = 1 - Math.pow(1 - t, 3);
      animation.object.position.y = animation.targetY + (1 - easing) * animation.lift;
    }
    this.renderer.render(this.scene, this.camera);
    this.container.dataset.renderFrames = String(this.frames);
  }
}
