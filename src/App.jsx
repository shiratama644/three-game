import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Axis,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Ray,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core';
import './App.css';
import { weaponConfig } from './config/weapon';
import { operatorConfig } from './config/operator';

const LOG_DURATION = 3000;
const HIT_MARKER_DURATION = 100;
const UI_SETTINGS_KEY = 'fpsDemoUISettings_v10';
const SPEED_LIMITS = { min: 0.6, max: 1.25 };
const PLAYER_COLLIDER_RADIUS = 0.35;

const defaultUiSettings = {
  damageLog: { left: '20px', top: '40%', right: 'auto', bottom: 'auto', scale: 1, opacity: 1 },
  joystick: { left: '40px', bottom: '40px', right: 'auto', top: 'auto', scale: 1, opacity: 1 },
  modeBtn: { right: '170px', bottom: '30px', left: 'auto', top: 'auto', scale: 1, opacity: 1 },
  adsBtn: { right: '140px', bottom: '90px', left: 'auto', top: 'auto', scale: 1, opacity: 1 },
  reloadBtn: { right: '40px', bottom: '150px', left: 'auto', top: 'auto', scale: 1, opacity: 1 },
  shootBtn: { right: '30px', bottom: '40px', left: 'auto', top: 'auto', scale: 1, opacity: 1 },
  hud: { right: '0px', bottom: '120px', left: 'auto', top: 'auto', scale: 1, opacity: 1 },
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toRad = (d) => (d * Math.PI) / 180;

const styleFromSettings = (s) => ({
  left: s.left,
  top: s.top,
  right: s.right,
  bottom: s.bottom,
  transform: `scale(${s.scale})`,
  opacity: s.opacity,
});

const emptyJoystick = {
  active: false,
  pointerId: null,
  baseX: 0,
  baseY: 0,
  stickX: 0,
  stickY: 0,
};

function App() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const gameRef = useRef({
    engine: null,
    scene: null,
    camera: null,
    weaponNode: null,
    muzzleNode: null,
    targets: [],
    obstacles: [],
    logsTimeouts: [],
    moveVector: { x: 0, y: 0 },
    lookPointerId: null,
    lookPrev: { x: 0, y: 0 },
    lookDelta: { x: 0, y: 0 },
    recoil: { x: 0, y: 0, z: 0 },
    walkTime: 0,
    triggerHeld: false,
    fireMode: 0,
    semiLocked: false,
    burstShotsRemaining: 0,
    nextBurstAt: 0,
    lastShotAt: 0,
    ammo: weaponConfig.stats.magSize,
    reserveAmmo: weaponConfig.stats.maxAmmo,
    isReloading: false,
    isADS: false,
    sprintWanted: false,
    sprintStopAt: 0,
    finalSpeeds: { walk: 0, sprint: 0, ads: 0 },
    timers: [],
  });

  const [hud, setHud] = useState({
    ammo: weaponConfig.stats.magSize,
    reserveAmmo: weaponConfig.stats.maxAmmo,
    isADS: false,
    isReloading: false,
    fireMode: 0,
  });
  const [logs, setLogs] = useState([]);
  const [hitMarker, setHitMarker] = useState('');
  const [spread, setSpread] = useState(false);
  const [customizeMode, setCustomizeMode] = useState(false);
  const [uiSettings, setUiSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_SETTINGS_KEY);
      if (!raw) return defaultUiSettings;
      const parsed = JSON.parse(raw);
      return { ...defaultUiSettings, ...parsed };
    } catch {
      return defaultUiSettings;
    }
  });
  const [selectedUiId, setSelectedUiId] = useState(null);
  const [joystick, setJoystick] = useState(emptyJoystick);
  const dragRef = useRef(null);
  const hitMarkerTimerRef = useRef(null);

  const selectedSettings = selectedUiId ? uiSettings[selectedUiId] : null;

  const saveHud = () => {
    const g = gameRef.current;
    setHud({
      ammo: g.ammo,
      reserveAmmo: g.reserveAmmo,
      isADS: g.isADS,
      isReloading: g.isReloading,
      fireMode: g.fireMode,
    });
  };

  const calcDamage = (distance, part) => {
    const { damageRanges, multipliers } = weaponConfig.stats;
    const base = damageRanges.find((x) => distance <= x.maxDist)?.damage ?? damageRanges[damageRanges.length - 1].damage;
    return Math.round(base * (multipliers[part] ?? 1));
  };

  const pushLog = (part, distance, damage, killed) => {
    const id = crypto.randomUUID();
    setLogs((prev) => [{ id, part, distance, damage, killed }, ...prev].slice(0, 6));
    const timeout = window.setTimeout(() => {
      setLogs((prev) => prev.filter((item) => item.id !== id));
    }, LOG_DURATION);
    gameRef.current.logsTimeouts.push(timeout);
  };

  const resetTarget = (node) => {
    node.metadata.hp = 100;
    node.position.x = (Math.random() - 0.5) * 12;
  };

  const reload = () => {
    const g = gameRef.current;
    if (g.isReloading || g.reserveAmmo <= 0 || g.ammo === weaponConfig.stats.magSize) return;
    g.isReloading = true;
    if (g.isADS) {
      g.isADS = false;
    }
    saveHud();
    const duration = g.ammo === 0 ? weaponConfig.stats.emptyReloadTime : weaponConfig.stats.reloadTime;
    const timer = window.setTimeout(() => {
      const need = weaponConfig.stats.magSize - g.ammo;
      const loaded = Math.min(need, g.reserveAmmo);
      g.ammo += loaded;
      g.reserveAmmo -= loaded;
      g.isReloading = false;
      saveHud();
    }, duration);
    g.timers.push(timer);
  };

  const shoot = (nowMs) => {
    const g = gameRef.current;
    if (!g.scene || !g.camera || g.ammo <= 0 || g.isReloading) return;

    g.ammo -= 1;
    g.lastShotAt = nowMs;
    saveHud();

    setSpread(true);
    const spreadTimer = window.setTimeout(() => setSpread(false), 80);
    g.timers.push(spreadTimer);

    const origin = g.camera.position.clone();
    const forward = g.camera.getDirection(Axis.Z).normalize();

    const spreadSettings = g.isADS
      ? weaponConfig.stats.spread.ads
      : g.sprintWanted
        ? weaponConfig.stats.spread.sprint
        : weaponConfig.stats.spread.hip;

    const right = Vector3.Cross(forward, Axis.Y).normalize();
    const up = Vector3.Cross(right, forward).normalize();
    forward
      .addInPlace(right.scale((Math.random() - 0.5) * spreadSettings.x))
      .addInPlace(up.scale((Math.random() - 0.5) * spreadSettings.y))
      .normalize();

    const ray = new Ray(origin, forward, 120);
    const pick = g.scene.pickWithRay(ray, (mesh) => !!mesh.metadata?.isHittable);

    if (pick?.hit && pick.pickedMesh?.metadata?.rootNode) {
      const rootNode = pick.pickedMesh.metadata.rootNode;
      const part = pick.pickedMesh.metadata.part ?? 'chest';
      const distance = Vector3.Distance(origin, pick.pickedPoint ?? origin);
      const damage = calcDamage(distance, part);

      rootNode.metadata.hp -= damage;
      const killed = rootNode.metadata.hp <= 0;
      if (killed) {
        resetTarget(rootNode);
      }

      if (hitMarkerTimerRef.current) {
        clearTimeout(hitMarkerTimerRef.current);
      }
      setHitMarker(killed ? 'kill' : 'hit');
      hitMarkerTimerRef.current = window.setTimeout(() => {
        setHitMarker('');
      }, HIT_MARKER_DURATION);
      g.timers.push(hitMarkerTimerRef.current);

      const hitMat = pick.pickedMesh.material;
      if (hitMat?.diffuseColor) {
        const oldColor = hitMat.diffuseColor.clone();
        hitMat.diffuseColor = new Color3(1, 1, 1);
        const flashTimer = window.setTimeout(() => {
          if (hitMat) {
            hitMat.diffuseColor = oldColor;
          }
        }, 50);
        g.timers.push(flashTimer);
      }

      pushLog(part, distance, damage, killed);
    }

    const recoilScale = g.isADS ? 0.8 : 1;
    g.recoil.x += weaponConfig.stats.recoil.rise * recoilScale;
    g.recoil.y += (Math.random() - 0.5) * weaponConfig.stats.recoil.kick * recoilScale;
    g.recoil.z += weaponConfig.stats.recoil.kickZ * recoilScale;
  };

  const handleShooting = (nowMs) => {
    const g = gameRef.current;

    if (g.burstShotsRemaining > 0 && nowMs >= g.nextBurstAt) {
      shoot(nowMs);
      g.burstShotsRemaining -= 1;
      g.nextBurstAt = nowMs + 60;
    }

    if (!g.triggerHeld) return;

    if (g.ammo <= 0) {
      reload();
      return;
    }

    if (g.isReloading) return;
    if (!g.sprintWanted && nowMs - g.sprintStopAt < weaponConfig.stats.sprintToFireTime) return;

    if (g.fireMode === 0) {
      if (nowMs - g.lastShotAt >= weaponConfig.stats.fireInterval) shoot(nowMs);
      return;
    }

    if (g.fireMode === 1) {
      if (!g.semiLocked) {
        shoot(nowMs);
        g.semiLocked = true;
      }
      return;
    }

    if (g.fireMode === 2 && !g.semiLocked && g.burstShotsRemaining === 0) {
      g.burstShotsRemaining = 3;
      g.nextBurstAt = nowMs;
      g.semiLocked = true;
    }
  };

  useEffect(() => {
    const g = gameRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const base = operatorConfig.baseSpeeds;
    const w = weaponConfig.mobility;
    const calc = (baseValue, mod) => baseValue * clamp(1 + mod, SPEED_LIMITS.min, SPEED_LIMITS.max);
    g.finalSpeeds = {
      walk: calc(base.walk, w.walk),
      sprint: calc(base.sprint, w.sprint),
      ads: calc(base.ads, w.ads),
    };

    const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.53, 0.8, 0.92, 1);

    const camera = new UniversalCamera('camera', new Vector3(0, operatorConfig.height, 8), scene);
    camera.minZ = 0.01;
    camera.fov = toRad(weaponConfig.visuals.hipFov);

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.8;
    const dl = new DirectionalLight('dir', new Vector3(-0.4, -1, -0.2), scene);
    dl.position = new Vector3(10, 20, 10);
    dl.intensity = 0.7;

    const ground = MeshBuilder.CreateGround('ground', { width: 200, height: 200 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = new Color3(0.25, 0.25, 0.25);
    ground.material = groundMat;
    g.obstacles = [ground];

    for (let i = 0; i < 20; i += 1) {
      const box = MeshBuilder.CreateBox(`obstacle-${i}`, { size: 3 }, scene);
      box.position = new Vector3((Math.random() - 0.5) * 80, 1.5, (Math.random() - 0.5) * 80);
      const boxMat = new StandardMaterial(`obstacleMat-${i}`, scene);
      boxMat.diffuseColor = Color3.Random();
      box.material = boxMat;
      g.obstacles.push(box);
    }

    const targetPositions = [new Vector3(0, 0, -10), new Vector3(5, 0, -25), new Vector3(-5, 0, -40), new Vector3(0, 0, -60)];
    const createTarget = (idx, position) => {
      const root = new TransformNode(`target-${idx}`, scene);
      root.position = position;
      root.metadata = { hp: 100 };

      const parts = [
        { name: 'head', size: { x: 0.25, y: 0.25, z: 0.25 }, y: 1.75, color: new Color3(1, 0.35, 0.35) },
        { name: 'chest', size: { x: 0.5, y: 0.5, z: 0.3 }, y: 1.35, color: new Color3(0.35, 0.35, 1) },
        { name: 'belly', size: { x: 0.45, y: 0.4, z: 0.3 }, y: 0.9, color: new Color3(1, 1, 0.35) },
        { name: 'leg', size: { x: 0.5, y: 0.7, z: 0.3 }, y: 0.35, color: new Color3(0.35, 1, 0.35) },
      ];

      parts.forEach((part, partIdx) => {
        const mesh = MeshBuilder.CreateBox(`target-${idx}-${part.name}`, { width: part.size.x, height: part.size.y, depth: part.size.z }, scene);
        mesh.position.y = part.y;
        mesh.parent = root;
        const mat = new StandardMaterial(`target-${idx}-${partIdx}`, scene);
        mat.diffuseColor = part.color;
        mesh.material = mat;
        mesh.metadata = { isHittable: true, part: part.name, rootNode: root };
      });

      const arm = (name, x) => {
        const mesh = MeshBuilder.CreateBox(`target-${idx}-${name}`, { width: 0.15, height: 0.7, depth: 0.15 }, scene);
        mesh.parent = root;
        mesh.position = new Vector3(x, 1.3, 0);
        const mat = new StandardMaterial(`target-${idx}-${name}-mat`, scene);
        mat.diffuseColor = new Color3(0.35, 1, 0.35);
        mesh.material = mat;
        mesh.metadata = { isHittable: true, part: 'arm', rootNode: root };
      };

      arm('larm', -0.35);
      arm('rarm', 0.35);
      g.targets.push(root);
    };

    targetPositions.forEach((position, idx) => createTarget(idx, position));

    const weaponNode = new TransformNode('weaponNode', scene);
    weaponNode.parent = camera;
    weaponNode.position = new Vector3(weaponConfig.visuals.hipPos.x, weaponConfig.visuals.hipPos.y, weaponConfig.visuals.hipPos.z);

    const body = MeshBuilder.CreateBox('weapon-body', { width: 0.1, height: 0.09, depth: 0.6 }, scene);
    body.parent = weaponNode;
    const bodyMat = new StandardMaterial('weapon-body-mat', scene);
    bodyMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
    body.material = bodyMat;

    const stock = MeshBuilder.CreateBox('weapon-stock', { width: 0.08, height: 0.12, depth: 0.25 }, scene);
    stock.parent = weaponNode;
    stock.position = new Vector3(0, -0.05, 0.4);
    stock.material = bodyMat;

    const barrel = MeshBuilder.CreateBox('weapon-barrel', { width: 0.04, height: 0.04, depth: 0.45 }, scene);
    barrel.parent = weaponNode;
    barrel.position = new Vector3(0, 0.02, -0.45);
    barrel.material = bodyMat;

    const muzzleNode = new TransformNode('muzzle', scene);
    muzzleNode.parent = weaponNode;
    muzzleNode.position = new Vector3(0, 0.02, -0.7);

    g.engine = engine;
    g.scene = scene;
    g.camera = camera;
    g.weaponNode = weaponNode;
    g.muzzleNode = muzzleNode;

    sceneRef.current = scene;

    const checkCollision = (position) =>
      g.obstacles.some((obstacle) => {
        if (obstacle.name === 'ground') return false;
        const box = obstacle.getBoundingInfo().boundingBox;
        const min = box.minimumWorld;
        const max = box.maximumWorld;
        return (
          position.x + PLAYER_COLLIDER_RADIUS > min.x &&
          position.x - PLAYER_COLLIDER_RADIUS < max.x &&
          position.z + PLAYER_COLLIDER_RADIUS > min.z &&
          position.z - PLAYER_COLLIDER_RADIUS < max.z
        );
      });

    engine.runRenderLoop(() => {
      const delta = engine.getDeltaTime() / 1000;
      const nowMs = performance.now();

      const look = g.lookDelta;
      g.camera.rotation.y += look.x * 0.0022 * operatorConfig.turnSpeed;
      g.camera.rotation.x += look.y * 0.0018 * operatorConfig.turnSpeed;
      g.camera.rotation.x = clamp(g.camera.rotation.x, -1.3, 1.3);
      g.lookDelta.x = 0;
      g.lookDelta.y = 0;

      const moveMag = Math.hypot(g.moveVector.x, g.moveVector.y);
      const moving = moveMag > 0.01;
      if (!moving && g.sprintWanted) {
        g.sprintWanted = false;
        g.sprintStopAt = nowMs;
      }

      const moveDirForward = g.camera.getDirection(Axis.Z);
      moveDirForward.y = 0;
      moveDirForward.normalize();
      const moveDirRight = g.camera.getDirection(Axis.X);
      moveDirRight.y = 0;
      moveDirRight.normalize();

      const speed = g.isADS
        ? g.finalSpeeds.ads
        : g.sprintWanted
          ? g.finalSpeeds.sprint
          : g.finalSpeeds.walk;

      if (moving) {
        const next = g.camera.position
          .add(moveDirForward.scale(g.moveVector.y * speed * delta))
          .add(moveDirRight.scale(g.moveVector.x * speed * delta));
        next.y = operatorConfig.height;
        if (!checkCollision(next)) {
          g.camera.position.copyFrom(next);
          g.walkTime += delta;
        }
      }

      const visualPos = g.isADS ? weaponConfig.visuals.adsPos : weaponConfig.visuals.hipPos;
      const adsFov = g.isADS ? weaponConfig.visuals.adsFov : weaponConfig.visuals.hipFov;
      g.weaponNode.position = Vector3.Lerp(g.weaponNode.position, new Vector3(visualPos.x, visualPos.y, visualPos.z - g.recoil.z), delta * 12);
      g.camera.fov += (toRad(adsFov) - g.camera.fov) * clamp(delta * 12, 0, 1);

      const bobScale = moving ? (g.sprintWanted ? 1.6 : 1) : 0;
      const bobY = Math.sin(g.walkTime * weaponConfig.visuals.bobSpeed) * weaponConfig.visuals.bobAmount * bobScale;
      g.weaponNode.position.y += bobY;

      g.camera.rotation.x -= g.recoil.x * delta * weaponConfig.stats.recoil.recover;
      g.camera.rotation.y -= g.recoil.y * delta * weaponConfig.stats.recoil.recover * 0.4;
      g.recoil.x *= Math.exp(-delta * weaponConfig.stats.recoil.recover);
      g.recoil.y *= Math.exp(-delta * weaponConfig.stats.recoil.recover);
      g.recoil.z *= Math.exp(-delta * weaponConfig.visuals.slideSpeed);

      handleShooting(nowMs);
      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      g.logsTimeouts.forEach((timeout) => clearTimeout(timeout));
      g.timers.forEach((timeout) => clearTimeout(timeout));
      engine.dispose();
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const modeLabel = useMemo(() => {
    if (hud.fireMode === 1) return 'SEMI';
    if (hud.fireMode === 2) return 'BURST';
    return 'AUTO';
  }, [hud.fireMode]);

  const beginCustomizeDrag = (event, id) => {
    if (!customizeMode) return;
    event.preventDefault();
    const current = uiSettings[id];
    if (!current) return;
    setSelectedUiId(id);

    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCustomizeMove = (event) => {
    if (!customizeMode || !dragRef.current) return;
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const left = clamp(event.clientX - drag.offsetX, 0, window.innerWidth - drag.width);
    const top = clamp(event.clientY - drag.offsetY, 0, window.innerHeight - drag.height);

    setUiSettings((prev) => ({
      ...prev,
      [drag.id]: {
        ...prev[drag.id],
        left: `${left}px`,
        top: `${top}px`,
        right: 'auto',
        bottom: 'auto',
      },
    }));
  };

  const endCustomizeDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
  };

  const startLook = (event) => {
    if (customizeMode) return;
    const g = gameRef.current;
    if (g.lookPointerId !== null) return;
    g.lookPointerId = event.pointerId;
    g.lookPrev = { x: event.clientX, y: event.clientY };
  };

  const moveLook = (event) => {
    const g = gameRef.current;
    if (g.lookPointerId !== event.pointerId || customizeMode) return;
    g.lookDelta.x += event.clientX - g.lookPrev.x;
    g.lookDelta.y += event.clientY - g.lookPrev.y;
    g.lookPrev = { x: event.clientX, y: event.clientY };
  };

  const endLook = (event) => {
    const g = gameRef.current;
    if (g.lookPointerId === event.pointerId) {
      g.lookPointerId = null;
    }
  };

  const startJoystick = (event) => {
    if (customizeMode) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const baseX = event.clientX - rect.left;
    const baseY = event.clientY - rect.top;
    setJoystick({ active: true, pointerId: event.pointerId, baseX, baseY, stickX: baseX, stickY: baseY });
  };

  const moveJoystick = (event) => {
    if (!joystick.active || joystick.pointerId !== event.pointerId || customizeMode) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    const dx = currentX - joystick.baseX;
    const dy = currentY - joystick.baseY;
    const dist = Math.hypot(dx, dy);
    const limit = 50;
    const scale = dist > limit ? limit / dist : 1;
    const clampedX = joystick.baseX + dx * scale;
    const clampedY = joystick.baseY + dy * scale;

    setJoystick((prev) => ({ ...prev, stickX: clampedX, stickY: clampedY }));

    const g = gameRef.current;
    g.moveVector.x = clamp((clampedX - joystick.baseX) / limit, -1, 1);
    g.moveVector.y = clamp((joystick.baseY - clampedY) / limit, -1, 1);
    g.sprintWanted = dist > 38;
  };

  const endJoystick = (event) => {
    if (!joystick.active || joystick.pointerId !== event.pointerId) return;
    const g = gameRef.current;
    g.moveVector = { x: 0, y: 0 };
    g.sprintWanted = false;
    g.sprintStopAt = performance.now();
    setJoystick(emptyJoystick);
  };

  const startShoot = () => {
    if (customizeMode) return;
    gameRef.current.triggerHeld = true;
    gameRef.current.semiLocked = false;
  };

  const stopShoot = () => {
    gameRef.current.triggerHeld = false;
    gameRef.current.semiLocked = false;
  };

  const toggleAds = () => {
    if (customizeMode || gameRef.current.isReloading) return;
    gameRef.current.isADS = !gameRef.current.isADS;
    saveHud();
  };

  const cycleMode = () => {
    if (customizeMode) return;
    gameRef.current.fireMode = (gameRef.current.fireMode + 1) % 3;
    gameRef.current.semiLocked = false;
    saveHud();
  };

  const saveLayout = () => {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(uiSettings));
    setCustomizeMode(false);
    setSelectedUiId(null);
  };

  const resetLayout = () => {
    localStorage.removeItem(UI_SETTINGS_KEY);
    setUiSettings(defaultUiSettings);
    setSelectedUiId(null);
  };

  const uiClass = (id) => `customizable${customizeMode ? ' custom-mode' : ''}${selectedUiId === id ? ' selected' : ''}`;

  return (
    <div className="app">
      <canvas ref={canvasRef} id="game-canvas" />
      <div
        className="look-layer"
        onPointerDown={startLook}
        onPointerMove={moveLook}
        onPointerUp={endLook}
        onPointerCancel={endLook}
      />

      <div className="ui-layer" onPointerMove={handleCustomizeMove} onPointerUp={endCustomizeDrag} onPointerCancel={endCustomizeDrag}>
        <div
          className={uiClass('damageLog')}
          style={styleFromSettings(uiSettings.damageLog)}
          onPointerDown={(e) => beginCustomizeDrag(e, 'damageLog')}
        >
          <div id="damage-log">
            {logs.map((log) => (
              <div key={log.id} className={`log-entry${log.killed ? ' kill' : ''}`}>
                <span className="part">{log.part.toUpperCase()}</span>
                <span className="dist">{log.distance.toFixed(1)}m</span>
                <span className="dmg">{log.damage}</span>
              </div>
            ))}
            {!logs.length && customizeMode && <div className="log-placeholder">DAMAGE LOG</div>}
          </div>
        </div>

        <div
          className={uiClass('joystick')}
          style={styleFromSettings(uiSettings.joystick)}
          onPointerDown={(e) => {
            beginCustomizeDrag(e, 'joystick');
            startJoystick(e);
          }}
          onPointerMove={moveJoystick}
          onPointerUp={endJoystick}
          onPointerCancel={endJoystick}
        >
          <div id="joystick-area">
            {joystick.active && (
              <>
                <div id="joystick-base" style={{ left: joystick.baseX, top: joystick.baseY }} />
                <div id="joystick-stick" style={{ left: joystick.stickX, top: joystick.stickY }} />
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          className={`${uiClass('modeBtn')} control-button mode-btn`}
          style={styleFromSettings(uiSettings.modeBtn)}
          onPointerDown={(e) => beginCustomizeDrag(e, 'modeBtn')}
          onClick={cycleMode}
        >
          <span className="btn-main">MODE</span>
          <span className="btn-label">{modeLabel}</span>
        </button>

        <button
          type="button"
          className={`${uiClass('adsBtn')} control-button`}
          style={styleFromSettings(uiSettings.adsBtn)}
          onPointerDown={(e) => beginCustomizeDrag(e, 'adsBtn')}
          onClick={toggleAds}
        >
          ADS
        </button>

        <button
          type="button"
          className={`${uiClass('reloadBtn')} control-button${hud.isReloading ? ' reloading' : ''}`}
          style={styleFromSettings(uiSettings.reloadBtn)}
          onPointerDown={(e) => beginCustomizeDrag(e, 'reloadBtn')}
          onClick={reload}
        >
          R
        </button>

        <button
          type="button"
          className={`${uiClass('shootBtn')} control-button shoot-btn`}
          style={styleFromSettings(uiSettings.shootBtn)}
          onPointerDown={(e) => {
            beginCustomizeDrag(e, 'shootBtn');
            startShoot();
          }}
          onPointerUp={stopShoot}
          onPointerCancel={stopShoot}
          onPointerLeave={stopShoot}
        >
          FIRE
        </button>

        <div
          className={uiClass('hud')}
          style={styleFromSettings(uiSettings.hud)}
          onPointerDown={(e) => beginCustomizeDrag(e, 'hud')}
        >
          <div id="hud">
            <div className="ammo-main">
              <span className={`ammo-count${hud.ammo <= 5 ? ' low' : ''}`}>{hud.ammo}</span>
              <span className="ammo-reserve">/{hud.reserveAmmo}</span>
            </div>
            <div className="hud-state">{hud.isADS ? 'ADS' : 'HIP'} • {modeLabel}</div>
          </div>
        </div>

        <button type="button" id="settings-btn" onClick={() => setCustomizeMode((v) => !v)}>
          UI
        </button>
      </div>

      <div id="reticle-container" className={`${hud.isADS ? 'ads' : ''} ${spread ? 'spread' : ''}`}>
        <div id="reticle-dot" />
        <div className="crosshair ch-top" />
        <div className="crosshair ch-bottom" />
        <div className="crosshair ch-left" />
        <div className="crosshair ch-right" />
        <div id="hit-marker" className={hitMarker ? `show ${hitMarker}` : ''} />
      </div>

      {customizeMode && (
        <div id="customize-overlay">
          <div className="edit-panel">
            <h3>UI CUSTOMIZE</h3>
            <p>Drag to move. Select an element to edit.</p>
            <label>
              SIZE
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={selectedSettings?.scale ?? 1}
                onChange={(e) => {
                  if (!selectedUiId) return;
                  const value = Number(e.target.value);
                  setUiSettings((prev) => ({ ...prev, [selectedUiId]: { ...prev[selectedUiId], scale: value } }));
                }}
              />
            </label>
            <label>
              OPACITY
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={selectedSettings?.opacity ?? 1}
                onChange={(e) => {
                  if (!selectedUiId) return;
                  const value = Number(e.target.value);
                  setUiSettings((prev) => ({ ...prev, [selectedUiId]: { ...prev[selectedUiId], opacity: value } }));
                }}
              />
            </label>
            <div className="buttons">
              <button type="button" onClick={resetLayout}>RESET</button>
              <button type="button" onClick={saveLayout}>SAVE</button>
              <button type="button" onClick={() => setCustomizeMode(false)}>CLOSE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
