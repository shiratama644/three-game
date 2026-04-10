// Three.js core components
let scene, camera, renderer, clock, raycaster;
let playerObj;

// Weapon object groups
let gunContainer, gunSwayGroup, gunBobGroup, gunRecoilGroup;
let gunMesh; 
let gunMag, leftArm, muzzle;

// Game objects and pools
const targets = [];
const obstacles = [];
const bulletPool = [];
const activeBullets = [];
const shellPool = []; 
const activeShells = []; 
const MAX_BULLETS = 50;
const MAX_SHELLS = 20; 

let isGunLoaded = false;

// Collision and dimensions
const playerBox = new THREE.Box3();
const obstacleBox = new THREE.Box3();
const playerSize = new THREE.Vector3(0.8, 2.0, 0.8);
const LOG_DISPLAY_DURATION = 3000;
const UI_SETTINGS_STORAGE_KEY = 'fpsDemoUISettings_v9';

// --- LOADED CONFIGURATIONS ---
let weaponConfig = null;   
let operatorConfig = null; 

// --- CALCULATED SPEEDS (Final values) ---
const finalSpeeds = { walk: 0, sprint: 0, ads: 0 };
const SPEED_LIMITS = { min: 0.6, max: 1.25 };

// Current game state
const gameState = { 
    ammo: 0, reserveAmmo: 0, maxAmmo: 0, 
    isReloading: false, isADS: false, triggerHeld: false,       
    fireMode: 0, burstShotsRemaining: 0, nextBurstTime: 0, semiFired: false,
    fireRate: 0, burstRate: 60, lastShotTime: 0, 
    walkTime: 0, reloadStartTime: 0, isSprinting: false, sprintStopTime: 0,
    currentMoveSpeed: 0,
    wantsToSprint: false
};

const controls = { movementVector: new THREE.Vector2() };
const activePointers = {}; 

// Virtual joystick settings
const joystickConfig = { 
    maxRadius: 50, sprintRadius: 120, sprintThreshold: 140,
    sprintAngle: 35, velocityThreshold: 0.99
};

// UI Customization state
let isCustomizeMode = false;
let dragTarget = null;
let selectedElement = null;
let defaultSettings = {};

const bulletHoleSettings = { size: 0.10, color: 0x888888, lifetime: 100000, offset: 0.02 };

// Animation state vectors
let currentRecoil = { x: 0, y: 0, z: 0, slideZ: 0 }; 
let targetSway = { x: 0, y: 0 };
let lookDelta = { x: 0, y: 0 };

// DOM Elements
const dom = {
    canvas: document.getElementById('game-canvas'),
    shootBtn: document.getElementById('shoot-btn'),
    reloadBtn: document.getElementById('reload-btn'),
    adsBtn: document.getElementById('ads-btn'),
    modeBtn: document.getElementById('mode-btn'),
    modeIcon: document.getElementById('mode-icon'),
    modeText: document.getElementById('mode-text'),
    settingsBtn: document.getElementById('settings-btn'),
    overlay: document.getElementById('customize-overlay'),
    saveBtn: document.getElementById('customize-save-btn'),
    cancelBtn: document.getElementById('customize-cancel-btn'),
    resetBtn: document.getElementById('customize-reset-btn'),
    sizeSlider: document.getElementById('size-slider'),
    opacitySlider: document.getElementById('opacity-slider'),
    reticleContainer: document.getElementById('reticle-container'),
    hitMarker: document.getElementById('hit-marker'),
    hudAmmo: document.getElementById('ammo-count'),
    hudReserve: document.getElementById('ammo-reserve'),
    joystickBase: document.getElementById('joystick-base'),
    joystickStick: document.getElementById('joystick-stick')
};

// Debug helper
function drawDebugLine(start, end, color = 0xff0000, duration = 100) {
    const material = new THREE.LineBasicMaterial({ color: color });
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    setTimeout(() => {
        scene.remove(line);
        geometry.dispose();
        material.dispose();
    }, duration);
}

// --- ASSET LOADING ---
async function loadGameData() {
    try {
        // JSファイルを動的インポート (Dynamic Import)
        // 注意: index.htmlのscriptタグに type="module" が必要です
        const gunModule = await import('../components/guns/ak47.js');
        const opModule = await import('../components/operators/default.js');

        // defaultエクスポートを取得
        weaponConfig = gunModule.default;
        operatorConfig = opModule.default;

        console.log("Game Data Loaded (JS Modules):", { weaponConfig, operatorConfig });
    } catch (e) {
        console.error("Error loading game assets:", e);
        alert("Failed to load game assets. Check console.");
    }
}

// --- SPEED CALCULATION LOGIC ---
function calculateMovementSpeeds() {
    if (!operatorConfig || !weaponConfig) return;

    const base = operatorConfig.baseSpeeds;
    const wMod = weaponConfig.mobility || { walk: 0, sprint: 0, ads: 0 };
    
    const totalModWalk = wMod.walk;
    const totalModSprint = wMod.sprint;
    const totalModAds = wMod.ads;

    const calc = (baseVal, modSum) => {
        let multiplier = 1.0 + modSum;
        multiplier = Math.max(SPEED_LIMITS.min, Math.min(SPEED_LIMITS.max, multiplier));
        return baseVal * multiplier;
    };

    finalSpeeds.walk = calc(base.walk, totalModWalk);
    finalSpeeds.sprint = calc(base.sprint, totalModSprint);
    finalSpeeds.ads = calc(base.ads, totalModAds);

    console.log("Calculated Speeds:", finalSpeeds);
}

// Initialize Three.js scene, camera, and game objects
async function init() {
    await loadGameData();
    if (!weaponConfig || !operatorConfig) return;

    calculateMovementSpeeds();

    gameState.ammo = weaponConfig.stats.magSize;
    gameState.maxAmmo = weaponConfig.stats.magSize;
    gameState.reserveAmmo = weaponConfig.stats.maxAmmo;
    gameState.fireRate = weaponConfig.stats.fireInterval;
    gameState.currentMoveSpeed = finalSpeeds.walk;

    clock = new THREE.Clock();
    raycaster = new THREE.Raycaster();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 20, 80);

    renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    
    playerObj = new THREE.Group();
    scene.add(playerObj);

    // JSファイルで定義されたVector3を直接使用
    camera = new THREE.PerspectiveCamera(weaponConfig.visuals.hipFov, window.innerWidth / window.innerHeight, 0.01, 1000); 
    playerObj.add(camera);
    camera.position.set(0, operatorConfig.height, 0); 

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    scene.add(dirLight);

    createLevel(); 
    createWeaponSystem(); 
    createTargets(); 
    createBulletPool();
    createShellPool(); 

    setupEvents();
    backupDefaultSettings(); 
    loadUISettings();
    updateHUD();
    
    animate();
}

// Generate ground and obstacles
function createLevel() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x444444 }));
    ground.rotation.x = -Math.PI / 2; 
    ground.receiveShadow = true; 
    ground.userData = { isGround: true };
    scene.add(ground);
    obstacles.push(ground);

    scene.add(new THREE.GridHelper(200, 100, 0x888888, 0x555555));
    const boxGeo = new THREE.BoxGeometry(3, 3, 3);
    for (let i = 0; i < 20; i++) {
        const box = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: Math.random() * 0xffffff }));
        box.position.set((Math.random() - 0.5) * 80, 1.5, (Math.random() - 0.5) * 80);
        box.castShadow = true; box.receiveShadow = true; scene.add(box); obstacles.push(box);
    }
}

// Create dummy targets with hitboxes
function createTargets() {
    const mats = {
        head: new THREE.MeshLambertMaterial({ color: 0xff5555 }), 
        chest: new THREE.MeshLambertMaterial({ color: 0x5555ff }), 
        belly: new THREE.MeshLambertMaterial({ color: 0xffff55 }), 
        limb: new THREE.MeshLambertMaterial({ color: 0x55ff55 })
    };
    const createTarget = (x, z) => {
        const group = new THREE.Group(); group.position.set(x, 0, z); group.userData = { hp: 100, isTarget: true }; 
        const addPart = (name, w, h, d, y, mat) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            mesh.position.y = y; mesh.userData = { part: name }; mesh.castShadow = true; mesh.receiveShadow = true;
            group.add(mesh); obstacles.push(mesh); 
        };
        addPart('head', 0.25, 0.25, 0.25, 1.75, mats.head);
        addPart('chest', 0.5, 0.5, 0.3, 1.35, mats.chest);
        addPart('belly', 0.45, 0.4, 0.3, 0.9, mats.belly);
        addPart('leg', 0.5, 0.7, 0.3, 0.35, mats.limb);
        const armGeo = new THREE.BoxGeometry(0.15, 0.7, 0.15);
        const lArm = new THREE.Mesh(armGeo, mats.limb); lArm.position.set(-0.35, 1.3, 0); lArm.userData = {part:'arm'}; obstacles.push(lArm); group.add(lArm);
        const rArm = new THREE.Mesh(armGeo, mats.limb); rArm.position.set(0.35, 1.3, 0); rArm.userData = {part:'arm'}; obstacles.push(rArm); group.add(rArm);
        scene.add(group); targets.push(group);
    };
    createTarget(0, -10); createTarget(5, -25); createTarget(-5, -40); createTarget(0, -60);
}

// Setup weapon hierarchy and attach to camera
function createWeaponSystem() {
    gunContainer = new THREE.Group(); camera.add(gunContainer);
    gunSwayGroup = new THREE.Group(); gunContainer.add(gunSwayGroup);
    gunBobGroup = new THREE.Group(); gunSwayGroup.add(gunBobGroup);
    gunRecoilGroup = new THREE.Group(); gunBobGroup.add(gunRecoilGroup);
    
    // JSファイルから直接Vector3を使用
    gunContainer.position.copy(weaponConfig.visuals.hipPos);

    // 武器ファイル内で定義されたメッシュ生成関数を呼び出す
    if (typeof weaponConfig.createMesh === 'function') {
        gunMesh = weaponConfig.createMesh();
    } else {
        console.error("Weapon config does not have createMesh function");
        return;
    }
    
    gunRecoilGroup.add(gunMesh);

    gunMag = gunMesh.getObjectByName("mag");
    leftArm = gunMesh.getObjectByName("leftArm");

    muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, -0.7);
    gunMesh.add(muzzle);

    isGunLoaded = true;
    console.log("Weapon created successfully (Modular JS).");
}

// Initialize bullet object pool
function createBulletPool() {
    const bulletGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    for (let i = 0; i < MAX_BULLETS; i++) {
        const bullet = new THREE.Mesh(bulletGeo, bulletMat);
        bullet.visible = false; bulletPool.push(bullet); scene.add(bullet);
    }
}

// Initialize shell casing pool
function createShellPool() {
    const shellGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6); 
    shellGeo.rotateX(Math.PI / 2); 
    const shellMat = new THREE.MeshLambertMaterial({ color: 0xd4af37 }); 
    for (let i = 0; i < MAX_SHELLS; i++) {
        const shell = new THREE.Mesh(shellGeo, shellMat);
        shell.visible = false; shell.castShadow = true;
        shellPool.push(shell); scene.add(shell);
    }
}

// Eject a shell casing from the gun
function spawnShell() {
    if (!isGunLoaded) return;
    const shell = shellPool.find(s => !s.visible);
    if (shell) {
        shell.visible = true;
        const worldQuat = new THREE.Quaternion();
        camera.getWorldQuaternion(worldQuat);
        const ejectPos = gunMesh.getWorldPosition(new THREE.Vector3());
        const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat);
        ejectPos.addScaledVector(rightDir, 0.1); 
        shell.position.copy(ejectPos);
        const vel = new THREE.Vector3((Math.random() * 0.5 + 1.2), (Math.random() * 0.5 + 1.5), (Math.random() * 0.5 + 0.8));
        vel.applyQuaternion(worldQuat);
        shell.userData.velocity = vel;
        shell.userData.rotVel = new THREE.Vector3(Math.random()*15, Math.random()*15, Math.random()*15);
        shell.userData.lifetime = 1.0; 
        activeShells.push(shell);
    }
}

// Update physics for active shells
function updateShells(delta) {
    for (let i = activeShells.length - 1; i >= 0; i--) {
        const s = activeShells[i];
        s.userData.lifetime -= delta;
        s.position.addScaledVector(s.userData.velocity, delta * 3); 
        s.userData.velocity.y -= 9.8 * delta;
        s.rotation.x += s.userData.rotVel.x * delta;
        s.rotation.y += s.userData.rotVel.y * delta;
        s.rotation.z += s.userData.rotVel.z * delta;

        if (s.position.y < 0.02) {
            s.position.y = 0.02;
            s.userData.velocity.y *= -0.5; 
            s.userData.velocity.x *= 0.8;  
            s.userData.velocity.z *= 0.8;
        }

        if (s.userData.lifetime <= 0) {
            s.visible = false;
            activeShells.splice(i, 1);
        }
    }
}

// Bind DOM events and Touch listeners
function setupEvents() {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const bindPressAction = (btn, handler) => {
        btn.addEventListener('touchstart', (e) => { stop(e); handler(); }, { passive: false });
        btn.addEventListener('click', (e) => { stop(e); handler(); });
    };

    bindPressAction(dom.settingsBtn, () => toggleCustomizeMode(true));
    bindPressAction(dom.saveBtn, saveUISettings);
    bindPressAction(dom.cancelBtn, () => toggleCustomizeMode(false));
    bindPressAction(dom.resetBtn, resetUISettings);

    const sliderHandler = (callback) => (e) => { e.stopPropagation(); if (selectedElement) callback(e.target.value); };
    dom.sizeSlider.addEventListener('input', sliderHandler((val) => { selectedElement.style.transform = `scale(${val})`; selectedElement.dataset.scale = val; }));
    dom.opacitySlider.addEventListener('input', sliderHandler((val) => { selectedElement.style.opacity = val; selectedElement.dataset.opacity = val; }));

    const bindGameBtn = (btn, action) => { btn.addEventListener('touchstart', (e) => handleButtonTouchStart(e, action), { passive: false }); };
    bindGameBtn(dom.shootBtn, 'shoot'); bindGameBtn(dom.reloadBtn, 'reload');
    bindGameBtn(dom.adsBtn, 'ads'); bindGameBtn(dom.modeBtn, 'mode');

    window.addEventListener('touchstart', onCustomizeTouchStart, { passive: false, capture: true });
    window.addEventListener('touchmove', onCustomizeTouchMove, { passive: false, capture: true });
    window.addEventListener('touchend', onCustomizeTouchEnd, { passive: false, capture: true });
    document.body.addEventListener('touchstart', handleGlobalTouchStart, { passive: false });
    document.body.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    document.body.addEventListener('touchend', handleGlobalTouchEnd, { passive: false });
    document.body.addEventListener('touchcancel', handleGlobalTouchEnd, { passive: false });
    window.addEventListener('resize', onWindowResize);
}

function handleButtonTouchStart(e, action) {
    if (isCustomizeMode) return;
    e.preventDefault(); e.stopPropagation(); 
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        activePointers[t.identifier] = { type: 'button', action: action, element: e.currentTarget, startX: t.clientX, startY: t.clientY, currentX: t.clientX, currentY: t.clientY };
        activateButtonAction(action, true);
        e.currentTarget.classList.add('active');
    }
}

// Handle screen touches for Joystick and Look controls
function handleGlobalTouchStart(e) {
    if (isCustomizeMode) return;
    if (e.target.closest('#settings-btn') || e.target.closest('.edit-panel')) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const x = t.clientX; const y = t.clientY;
        if (x < window.innerWidth / 2) {
            const existingJoy = Object.values(activePointers).find(p => p.type === 'joystick');
            if (!existingJoy) {
                activePointers[t.identifier] = { type: 'joystick', startX: x, startY: y, currentX: x, currentY: y, startTime: Date.now() };
                showJoystick(x, y);
            }
        } else {
            const existingLook = Object.values(activePointers).find(p => p.type === 'look');
            if (!existingLook) activePointers[t.identifier] = { type: 'look', startX: x, startY: y, currentX: x, currentY: y };
        }
    }
}

function handleGlobalTouchMove(e) {
    if (isCustomizeMode) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const pointer = activePointers[t.identifier];
        if (pointer) {
            pointer.currentX = t.clientX; pointer.currentY = t.clientY;
            if (pointer.type === 'joystick') updateJoystick(pointer);
            else if (pointer.type === 'look') { updateLook(pointer); pointer.startX = t.clientX; pointer.startY = t.clientY; }
            else if (pointer.type === 'button' && (pointer.action === 'shoot' || pointer.action === 'ads')) { updateLook(pointer); pointer.startX = t.clientX; pointer.startY = t.clientY; }
        }
    }
}

function handleGlobalTouchEnd(e) {
    if (isCustomizeMode) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const pointer = activePointers[t.identifier];
        if (pointer) {
            if (pointer.type === 'button') {
                activateButtonAction(pointer.action, false);
                if(pointer.element) pointer.element.classList.remove('active');
            } else if (pointer.type === 'joystick') {
                hideJoystick();
                controls.movementVector.set(0, 0);
                if(gameState.isSprinting) {
                    gameState.isSprinting = false; gameState.sprintStopTime = clock.getElapsedTime() * 1000;
                    dom.reticleContainer.classList.remove('spread');
                }
            }
            delete activePointers[t.identifier];
        }
    }
}

function activateButtonAction(action, isActive) {
    if (action === 'shoot') { isActive ? startShooting() : stopShooting(); }
    else if (action === 'reload') { if (isActive) reload(); }
    else if (action === 'ads') { if (isActive) toggleADS(); }
    else if (action === 'mode') { if (isActive) cycleFireMode(); }
}

function showJoystick(x, y) {
    dom.joystickBase.style.display = 'block'; dom.joystickStick.style.display = 'block';
    const rect = document.getElementById('joystick-area').getBoundingClientRect();
    dom.joystickBase.style.left = `${x - rect.left}px`; dom.joystickBase.style.top = `${y - rect.top}px`;
    dom.joystickStick.style.left = `${x - rect.left}px`; dom.joystickStick.style.top = `${y - rect.top}px`;
    dom.joystickBase.dataset.baseX = x; dom.joystickBase.dataset.baseY = y;
}

// Calculate joystick vector and sprint logic
function updateJoystick(pointer) {
    const baseX = parseFloat(dom.joystickBase.dataset.baseX);
    const baseY = parseFloat(dom.joystickBase.dataset.baseY);
    let dx = pointer.currentX - baseX; let dy = pointer.currentY - baseY;
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = angleRad * (180 / Math.PI);
    let angleDiff = Math.abs(angleDeg - (-90));
    if (angleDiff > 180) angleDiff = 360 - angleDiff;
    const isInSprintZone = angleDiff <= joystickConfig.sprintAngle;
    const timeDelta = Date.now() - pointer.startTime;
    const isQuickFlick = (timeDelta < 250 && distance > 30 && (distance / timeDelta) > joystickConfig.velocityThreshold);
    const isDeepPush = distance > joystickConfig.sprintThreshold;
    const maintainThreshold = joystickConfig.maxRadius * 0.8; 

    if (gameState.wantsToSprint) {
        if (isInSprintZone && distance > maintainThreshold) gameState.wantsToSprint = true;
        else gameState.wantsToSprint = false;
    } else {
        if (isInSprintZone && (isDeepPush || isQuickFlick)) gameState.wantsToSprint = true;
        else gameState.wantsToSprint = false;
    }
    dom.joystickStick.style.backgroundColor = gameState.wantsToSprint ? "rgba(244, 208, 63, 0.8)" : "rgba(255, 255, 255, 0.8)";
    
    const visualLimit = isInSprintZone ? joystickConfig.sprintRadius : joystickConfig.maxRadius;
    let visualDist = distance;
    if (visualDist > visualLimit) {
        const ratio = visualLimit / visualDist;
        dx *= ratio; dy *= ratio; visualDist = visualLimit;
    }
    const rect = document.getElementById('joystick-area').getBoundingClientRect();
    dom.joystickStick.style.left = `${(baseX - rect.left) + dx}px`;
    dom.joystickStick.style.top = `${(baseY - rect.top) + dy}px`;
    
    let inputRatio = distance / joystickConfig.maxRadius;
    if (inputRatio > 1.0) inputRatio = 1.0;
    const normX = distance > 0 ? (dx / visualDist) : 0;
    const normY = distance > 0 ? (dy / visualDist) : 0;
    controls.movementVector.set(normX * inputRatio, normY * inputRatio);
}

function hideJoystick() { dom.joystickBase.style.display = 'none'; dom.joystickStick.style.display = 'none'; }
function updateLook(pointer) { lookDelta.x += pointer.currentX - pointer.startX; lookDelta.y += pointer.currentY - pointer.startY; }

// Main Game Loop
function animate() {
    requestAnimationFrame(animate);
    if (isCustomizeMode) { renderer.render(scene, camera); return; }
    const delta = Math.min(clock.getDelta(), 0.1);
    const now = clock.getElapsedTime();
    
    if (lookDelta.x !== 0 || lookDelta.y !== 0) {
        playerObj.rotation.y -= lookDelta.x * 0.0025 * operatorConfig.turnSpeed;
        camera.rotation.x -= lookDelta.y * 0.0025 * operatorConfig.turnSpeed;
        camera.rotation.x = Math.max(-1.5, Math.min(1.5, camera.rotation.x));
        targetSway.x = -lookDelta.x * weaponConfig.visuals.swayAmount; targetSway.y = lookDelta.y * weaponConfig.visuals.swayAmount;
        lookDelta.x = 0; lookDelta.y = 0;
    } else { targetSway.x = 0; targetSway.y = 0; }

    updateMovement(delta); 
    updateWeaponAnimation(delta); 
    updateBullets(delta); 
    updateShells(delta); 
    handleShooting(now);
    renderer.render(scene, camera);
}

// Handle player movement and collision detection
function updateMovement(delta) {
    const inputX = controls.movementVector.x; const inputY = controls.movementVector.y;
    const inputMag = Math.sqrt(inputX*inputX + inputY*inputY);
    const wasSprinting = gameState.isSprinting;
    gameState.isSprinting = (gameState.wantsToSprint && inputMag > 0.1 && !gameState.isADS);
    if (wasSprinting && !gameState.isSprinting) {
        gameState.sprintStopTime = clock.getElapsedTime() * 1000; dom.reticleContainer.classList.remove('spread');
    }
    if (gameState.isSprinting) dom.reticleContainer.classList.add('spread');
    
    if (inputX === 0 && inputY === 0) return;
    
    let targetSpeed = finalSpeeds.walk;
    if (gameState.isADS) targetSpeed = finalSpeeds.ads; 
    else if (gameState.isSprinting) targetSpeed = finalSpeeds.sprint;
    
    gameState.currentMoveSpeed = THREE.MathUtils.lerp(gameState.currentMoveSpeed, targetSpeed, delta * 10);
    const speed = gameState.currentMoveSpeed * delta;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const move = new THREE.Vector3(); move.addScaledVector(right, inputX); move.addScaledVector(dir, -inputY); 
    move.normalize().multiplyScalar(speed);
    const nextX = playerObj.position.clone(); nextX.x += move.x;
    if (!checkCollision(nextX)) playerObj.position.x = nextX.x;
    const nextZ = playerObj.position.clone(); nextZ.z += move.z;
    if (!checkCollision(nextZ)) playerObj.position.z = nextZ.z;
}

function checkCollision(position) {
    const pCenter = position.clone(); pCenter.y = 1.0; playerBox.setFromCenterAndSize(pCenter, playerSize);
    for (const obstacle of obstacles) {
        if (obstacle.userData.part || obstacle.userData.isGround) continue; 
        
        obstacleBox.setFromObject(obstacle);
        if (playerBox.intersectsBox(obstacleBox)) return true;
    }
    return false;
}

// Procedural weapon animation (ADS, Sway, Bob, Recoil)
function updateWeaponAnimation(delta) {
    if (!isGunLoaded) return;

    const visuals = weaponConfig.visuals;
    const stats = weaponConfig.stats; // statsへの参照を追加

    const targetFov = gameState.isADS ? visuals.adsFov : visuals.hipFov;
    const adsSpeed = 1.0 / (stats.adsTime / 1000); 
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * adsSpeed * 4); camera.updateProjectionMatrix();
    const targetPos = gameState.isADS ? visuals.adsPos : visuals.hipPos;
    gunContainer.position.lerp(targetPos, delta * adsSpeed * 4);

    if(gameState.isADS) { targetSway.x *= 0.1; targetSway.y *= 0.1; }
    gunSwayGroup.rotation.y = THREE.MathUtils.lerp(gunSwayGroup.rotation.y, targetSway.x, delta * visuals.swaySmooth);
    gunSwayGroup.rotation.x = THREE.MathUtils.lerp(gunSwayGroup.rotation.x, targetSway.y, delta * visuals.swaySmooth);
    
    const isMoving = controls.movementVector.lengthSq() > 0.01;
    if (isMoving) {
        gameState.walkTime += delta * visuals.bobSpeed;
        const bobMult = gameState.isADS ? 0.1 : 1.0;
        gunBobGroup.position.y = Math.sin(gameState.walkTime) * visuals.bobAmount * bobMult;
        gunBobGroup.position.x = Math.cos(gameState.walkTime * 0.5) * visuals.bobAmount * bobMult;
    } else {
        gameState.walkTime = 0; gunBobGroup.position.lerp(new THREE.Vector3(0,0,0), delta * 10);
    }

    // 【修正】visuals.recoilRecover -> stats.recoil.recover に変更
    currentRecoil.x = THREE.MathUtils.lerp(currentRecoil.x, 0, delta * stats.recoil.recover);
    currentRecoil.y = THREE.MathUtils.lerp(currentRecoil.y, 0, delta * stats.recoil.recover);
    currentRecoil.z = THREE.MathUtils.lerp(currentRecoil.z, 0, delta * stats.recoil.recover);
    currentRecoil.slideZ = THREE.MathUtils.lerp(currentRecoil.slideZ, 0, delta * visuals.slideSpeed);
    
    if (gameState.isReloading) handleReloadAnimation();
    else {
        if (gunMag && gunMag.userData.originalPos) {
            gunMag.position.copy(gunMag.userData.originalPos);
            gunMag.rotation.copy(gunMag.userData.originalRot);
        }
        if (leftArm && leftArm.userData.originalPos) { 
            leftArm.position.copy(leftArm.userData.originalPos); 
            leftArm.rotation.copy(leftArm.userData.originalRot); 
        }
    }
    
    let reloadRot = gameState.isReloading ? -0.1 : 0;
    gunRecoilGroup.rotation.x = currentRecoil.x + THREE.MathUtils.lerp(gunRecoilGroup.rotation.x, reloadRot, delta * 8);
    gunRecoilGroup.rotation.y = currentRecoil.y;
    gunRecoilGroup.position.z = currentRecoil.z;
}

// Update bullet positions and handle hit detection
function updateBullets(delta) {
    const validObstacles = obstacles.filter(obj => obj.name !== 'mag' && obj.name !== 'leftArm');

    for (let i = activeBullets.length - 1; i >= 0; i--) {
        const b = activeBullets[i]; 
        const prev = b.position.clone(); 
        
        b.position.add(b.velocity.clone().multiplyScalar(delta)); 
        b.lifetime -= delta;

        const dir = b.position.clone().sub(prev); 
        const len = dir.length(); 
        
        raycaster.set(prev, dir.normalize()); 
        
        const hits = raycaster.intersectObjects(validObstacles);

        if (hits.length > 0 && hits[0].distance <= len) {
            const hitObj = hits[0].object; 
            const hitPoint = hits[0].point; 
            
            createBulletHole(hitPoint, hits[0].face.normal);

            if (hitObj.userData.part) {
                const targetGroup = hitObj.parent; 
                const dist = playerObj.position.distanceTo(hitPoint);
                let baseDamage = 19; 
                for(const r of weaponConfig.stats.damageRanges) { if (dist <= r.maxDist) { baseDamage = r.damage; break; } }
                
                const multiplier = weaponConfig.stats.multipliers[hitObj.userData.part] || 1.0; 
                const finalDamage = Math.floor(baseDamage * multiplier);
                
                targetGroup.userData.hp -= finalDamage; 
                const killed = targetGroup.userData.hp <= 0;
                
                // showHitMarker(killed);
                logDamage(hitObj.userData.part, dist, finalDamage, killed);
                
                if (killed) resetTarget(targetGroup); 
                else { 
                    const oldColor = hitObj.material.color.getHex(); 
                    hitObj.material.color.setHex(0xffaaaa); 
                    setTimeout(() => { if(hitObj.material) hitObj.material.color.setHex(oldColor); }, 50); 
                }
            }
            b.visible = false; activeBullets.splice(i, 1); continue;
        }
        if (b.lifetime <= 0) { b.visible = false; activeBullets.splice(i, 1); }
    }
}

// Procedural reload animation sequence
function handleReloadAnimation() {
    if (!isGunLoaded || !gunMag) return;

    const duration = (gameState.ammo === 0) ? weaponConfig.stats.emptyReloadTime : weaponConfig.stats.reloadTime;
    const elapsed = (clock.getElapsedTime() - gameState.reloadStartTime) * 1000;
    const progress = Math.min(elapsed / duration, 1.0);
    
    const magBasePos = gunMag.userData.originalPos; 
    const magDropPos = new THREE.Vector3(0, -1.0, 0.2); 

    const armBasePos = leftArm.userData.originalPos; 
    const armGripPos = new THREE.Vector3(-0.20, -0.20, 0.5); 

    if (progress < 0.2) {
        const t = progress / 0.2; 
        leftArm.position.lerpVectors(armBasePos, armGripPos, t); 
        leftArm.rotation.x = THREE.MathUtils.lerp(leftArm.userData.originalRot.x, 0.2, t);
    } else if (progress < 0.5) {
        const t = (progress - 0.2) / 0.3; 
        gunMag.position.lerpVectors(magBasePos, magDropPos, t * t);
        
        const currentMagMove = new THREE.Vector3().subVectors(gunMag.position, magBasePos); 
        leftArm.position.copy(armGripPos).add(currentMagMove); 
        leftArm.rotation.x = 0.2;
    } else if (progress < 0.85) {
        const t = (progress - 0.5) / 0.35; 
        gunMag.position.lerpVectors(magDropPos, magBasePos, Math.sqrt(t));
        
        const currentMagMove = new THREE.Vector3().subVectors(gunMag.position, magBasePos); 
        leftArm.position.copy(armGripPos).add(currentMagMove); 
        leftArm.rotation.x = 0.2;
    } else if (progress < 1.0) {
        const t = (progress - 0.85) / 0.15; 
        gunMag.position.copy(magBasePos); 
        leftArm.position.lerpVectors(armGripPos, armBasePos, t); 
        leftArm.rotation.x = THREE.MathUtils.lerp(0.2, leftArm.userData.originalRot.x, t);
    } else { 
        gunMag.position.copy(magBasePos); 
        leftArm.position.copy(armBasePos); 
        leftArm.rotation.copy(leftArm.userData.originalRot); 
    }
}

// Fire rate and burst logic controller
function handleShooting(now) {
    if (!isGunLoaded) return; 

    const timeMs = now * 1000;
    if (gameState.burstShotsRemaining > 0) {
        if (timeMs >= gameState.nextBurstTime) { shoot(now); gameState.burstShotsRemaining--; gameState.nextBurstTime = timeMs + gameState.burstRate; }
    }
    if (gameState.triggerHeld) {
        if (gameState.isReloading || gameState.ammo <= 0) {
            if (gameState.ammo <= 0 && !gameState.isReloading) reload(); return;
        }
        if (!gameState.isSprinting && (timeMs - gameState.sprintStopTime) < weaponConfig.stats.sprintToFireTime) return;
        if ((timeMs - gameState.sprintStopTime) < weaponConfig.stats.sprintToFireTime) return;
        if (gameState.fireMode === 0) { if (timeMs - gameState.lastShotTime > gameState.fireRate) shoot(now); }
        else if (gameState.fireMode === 1) { if (!gameState.semiFired) { shoot(now); gameState.semiFired = true; } }
        else if (gameState.fireMode === 2) { if (!gameState.semiFired && gameState.burstShotsRemaining === 0) { gameState.burstShotsRemaining = 3; gameState.nextBurstTime = timeMs; gameState.semiFired = true; } }
    }
}

// Hybrid Raycast Implementation:
// 1. Cast ray from Camera to find target point in world.
// 2. Cast ray from Muzzle to that target point for visual accuracy.
function shoot(now) {
    if (gameState.ammo <= 0) return;
    gameState.lastShotTime = now * 1000; gameState.ammo--; updateHUD();
    
    spawnShell();

    const bullet = bulletPool.find(b => !b.visible);
    if (bullet) {
        bullet.visible = true; 
        
        playerObj.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);

        // Step 1: Determine target from camera view
        const rayOrigin = new THREE.Vector3();
        camera.getWorldPosition(rayOrigin);

        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);

        const rayStartPos = rayOrigin.clone().add(camDir.clone().multiplyScalar(0.5));
        
        raycaster.set(rayStartPos, camDir);
        
        const validObstacles = obstacles.filter(obj => {
            if (obj.name === 'mag' || obj.name === 'leftArm') return false;
            if (obj === playerBox) return false; 
            return true;
        });

        const hits = raycaster.intersectObjects(validObstacles);
        
        let targetPoint = new THREE.Vector3();
        let hitDistance = 100; 

        const validHit = hits.find(h => h.distance > 2.0);

        if (validHit) {
            targetPoint.copy(validHit.point);
            hitDistance = validHit.distance;
        } else {
            targetPoint.copy(rayStartPos).add(camDir.multiplyScalar(100));
        }

        // drawDebugLine(rayStartPos, targetPoint, 0xff0000, 100);

        // Step 2: Calculate bullet trajectory from muzzle to target
        const muzzlePos = new THREE.Vector3(); 
        if (muzzle) muzzle.getWorldPosition(muzzlePos);
        else gunMesh.getWorldPosition(muzzlePos); 

        const finalDir = new THREE.Vector3().subVectors(targetPoint, muzzlePos).normalize();

        // Apply spread
        let spreadSettings = gameState.isADS ? weaponConfig.stats.spread.ads : (gameState.isSprinting ? weaponConfig.stats.spread.sprint : weaponConfig.stats.spread.hip);
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(finalDir, up).normalize();
        const realUp = new THREE.Vector3().crossVectors(right, finalDir).normalize();
        
        finalDir.addScaledVector(right, (Math.random() - 0.5) * spreadSettings.x);
        finalDir.addScaledVector(realUp, (Math.random() - 0.5) * spreadSettings.y);
        finalDir.normalize();

        const checkDir = new THREE.Vector3();
        camera.getWorldDirection(checkDir);
        if (finalDir.dot(checkDir) < 0.2) {
            finalDir.copy(checkDir);
        }

        // drawDebugLine(muzzlePos, muzzlePos.clone().add(finalDir.clone().multiplyScalar(hitDistance)), 0x00ff00, 100);

        bullet.position.copy(muzzlePos);
        bullet.velocity = finalDir.multiplyScalar(150); 
        bullet.lifetime = 1.5;
        activeBullets.push(bullet);
        
        if (muzzle) {
            const flash = new THREE.PointLight(0xffaa00, 1.5, 4); 
            muzzle.add(flash); 
            setTimeout(() => muzzle.remove(flash), 40);
        }
        
        // Apply recoil
        const rMult = gameState.isADS ? 0.8 : 1.0;
        const visuals = weaponConfig.visuals;
        const recoil = weaponConfig.stats.recoil; // stats.recoilへの参照を追加

        // 【修正】visuals.recoilRise/Kick -> recoil.rise/kick に変更
        camera.rotation.x += recoil.rise * rMult; 
        camera.rotation.x = Math.min(1.5, camera.rotation.x); 
        
        currentRecoil.x += recoil.rise * rMult; 
        currentRecoil.y += (Math.random() - 0.5) * recoil.kick * rMult;
        currentRecoil.z += recoil.kickZ * rMult; 
        
        // スライドの後退アニメーションは見た目の設定なのでvisualsのままでOK
        currentRecoil.slideZ = visuals.slideTravel; 
    }
}

/*
function showHitMarker(killed) {
    const hm = dom.hitMarker; hm.classList.remove('hit', 'kill'); void hm.offsetWidth; hm.classList.add('hit');
    if (killed) hm.classList.add('kill'); setTimeout(() => hm.classList.remove('hit', 'kill'), 150);
}
*/

function createBulletHole(position, normal) {
    const geometry = new THREE.PlaneGeometry(bulletHoleSettings.size, bulletHoleSettings.size);
    const material = new THREE.MeshBasicMaterial({ color: bulletHoleSettings.color, side: THREE.DoubleSide });
    const hole = new THREE.Mesh(geometry, material);
    hole.position.copy(position).add(normal.clone().multiplyScalar(bulletHoleSettings.offset));
    hole.lookAt(hole.position.clone().add(normal));
    scene.add(hole); setTimeout(() => { scene.remove(hole); geometry.dispose(); material.dispose(); }, bulletHoleSettings.lifetime);
}

function resetTarget(group) { group.userData.hp = 100; group.position.x = (Math.random() - 0.5) * 10; }
function startShooting() { gameState.triggerHeld = true; }
function stopShooting() { gameState.triggerHeld = false; gameState.semiFired = false; }
function cycleFireMode() {
    gameState.fireMode = (gameState.fireMode + 1) % 3;
    if (gameState.fireMode === 0) { dom.modeIcon.className = "fa-solid fa-infinity"; dom.modeText.innerText = "AUTO"; } 
    else if (gameState.fireMode === 1) { dom.modeIcon.className = "fa-solid fa-circle-dot"; dom.modeText.innerText = "SEMI"; } 
    else if (gameState.fireMode === 2) { dom.modeIcon.className = "fa-solid fa-layer-group"; dom.modeText.innerText = "BURST"; }
}

function reload() {
    if (gameState.isReloading || gameState.reserveAmmo <= 0 || gameState.ammo === gameState.maxAmmo) return;
    gameState.isReloading = true; gameState.reloadStartTime = clock.getElapsedTime();
    if(gameState.isADS) toggleADS();
    dom.reloadBtn.classList.add('reloading'); dom.hudAmmo.style.opacity = '0.5';
    const duration = (gameState.ammo === 0) ? weaponConfig.stats.emptyReloadTime : weaponConfig.stats.reloadTime;
    setTimeout(() => {
        const needed = gameState.maxAmmo - gameState.ammo; const loaded = Math.min(needed, gameState.reserveAmmo);
        gameState.ammo += loaded; gameState.reserveAmmo -= loaded;
        gameState.isReloading = false; dom.reloadBtn.classList.remove('reloading'); dom.hudAmmo.style.opacity = '1.0'; updateHUD();
    }, duration);
}

function toggleADS() { if (!gameState.isReloading) { gameState.isADS = !gameState.isADS; dom.reticleContainer.classList.toggle('ads', gameState.isADS); } }
function updateHUD() { dom.hudAmmo.innerText = gameState.ammo; dom.hudReserve.innerText = gameState.reserveAmmo; if(gameState.ammo <= 5) dom.hudAmmo.classList.add('low'); else dom.hudAmmo.classList.remove('low'); }

function logDamage(part, dist, dmg, killed) {
    const log = document.getElementById('damage-log');
    const line = document.createElement('div');
    line.className = 'log-entry' + (killed ? ' kill' : '');
    let color = '#fff'; if (part === 'head') color = '#e74c3c'; else if (part === 'chest') color = '#3498db';
    const icon = killed ? '<i class="fa-solid fa-skull"></i> ' : '';
    line.innerHTML = `<span style="color:${color}">${icon}${part.toUpperCase()}</span> <span style="font-size:12px;color:#bbb;">${dist.toFixed(1)}m</span> <span style="font-weight:bold;">${dmg}</span>`;
    log.prepend(line); if (log.childElementCount > 6) log.lastChild.remove();
    setTimeout(() => { if (line.parentNode) line.remove(); }, LOG_DISPLAY_DURATION);
}

function onWindowResize() { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }

// UI Customization Logic
function toggleCustomizeMode(enable) {
    isCustomizeMode = enable; dom.overlay.style.display = enable ? 'flex' : 'none';
    document.querySelector('#ui-container').classList.toggle('customize-mode', enable);
    if (enable) {
        gameState.triggerHeld = false; controls.movementVector.set(0, 0);
        dom.joystickBase.style.display='none'; dom.joystickStick.style.display='none';
        for(let k in activePointers) delete activePointers[k];
    } else if (selectedElement) { selectedElement.classList.remove('selected'); selectedElement = null; }
}

function onCustomizeTouchStart(e) {
    if (!isCustomizeMode) return;
    if (e.target.closest('.edit-panel')) return;
    const t = e.changedTouches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const targetEl = el ? el.closest('.customizable') : null;
    if (targetEl) {
        e.preventDefault(); e.stopPropagation();
        if (selectedElement) selectedElement.classList.remove('selected');
        selectedElement = targetEl; selectedElement.classList.add('selected');
        dom.sizeSlider.value = parseFloat(targetEl.dataset.scale || 1.0);
        dom.opacitySlider.value = parseFloat(targetEl.dataset.opacity || 1.0);
        const r = targetEl.getBoundingClientRect();
        dragTarget = { el: targetEl, id: t.identifier, off: {x: t.clientX-r.left, y: t.clientY-r.top} };
        targetEl.style.left = `${r.left}px`; targetEl.style.top = `${r.top}px`;
        targetEl.style.right = 'auto'; targetEl.style.bottom = 'auto';
    } else if (!e.target.closest('.edit-panel') && selectedElement) { selectedElement.classList.remove('selected'); selectedElement = null; }
}
function onCustomizeTouchMove(e) {
    if (!isCustomizeMode || !dragTarget) return;
    e.preventDefault(); e.stopPropagation();
    for (const t of e.changedTouches) {
        if (t.identifier === dragTarget.id) {
            let newLeft = t.clientX - dragTarget.off.x; let newTop = t.clientY - dragTarget.off.y;
            dragTarget.el.style.left = `${Math.max(0, Math.min(newLeft, window.innerWidth - dragTarget.el.offsetWidth))}px`;
            dragTarget.el.style.top = `${Math.max(0, Math.min(newTop, window.innerHeight - dragTarget.el.offsetHeight))}px`;
        }
    }
}
function onCustomizeTouchEnd(e) { if (!isCustomizeMode || !dragTarget) return; for (const t of e.changedTouches) if (t.identifier === dragTarget.id) dragTarget = null; }

function backupDefaultSettings() { document.querySelectorAll('.customizable').forEach(el => { const s = window.getComputedStyle(el); defaultSettings[el.dataset.id] = { left: s.left, top: s.top, right: s.right, bottom: s.bottom, transform: 'scale(1.0)', opacity: '1.0' }; }); }
function saveUISettings() {
    const s = {}; document.querySelectorAll('.customizable').forEach(el => s[el.dataset.id] = { left: el.style.left, top: el.style.top, scale: el.dataset.scale||1.0, opacity: el.dataset.opacity||1.0 });
    localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(s)); toggleCustomizeMode(false);
}
function applyElementSettings(el, s) {
    if (s.left && s.left !== 'auto') { el.style.left = s.left; el.style.right = 'auto'; }
    if (s.top && s.top !== 'auto') { el.style.top = s.top; el.style.bottom = 'auto'; }
    if ((!s.left || s.left==='auto') && s.right) el.style.right = s.right;
    if ((!s.top || s.top==='auto') && s.bottom) el.style.bottom = s.bottom;
    if (s.scale) { el.style.transform = `scale(${s.scale})`; el.dataset.scale = s.scale; }
    if (s.opacity) { el.style.opacity = s.opacity; el.dataset.opacity = s.opacity; }
}
function loadUISettings() { try { const s = JSON.parse(localStorage.getItem(UI_SETTINGS_STORAGE_KEY)); if(s) document.querySelectorAll('.customizable').forEach(el => { if(s[el.dataset.id]) applyElementSettings(el, s[el.dataset.id]); }); } catch(e){} }
function resetUISettings() {
    document.querySelectorAll('.customizable').forEach(el => { const d = defaultSettings[el.dataset.id]; if(d) { el.style.left = d.left; el.style.top = d.top; el.style.right = d.right; el.style.bottom = d.bottom; el.style.transform = d.transform; el.style.opacity = d.opacity; el.dataset.scale=1.0; el.dataset.opacity=1.0; } });
    localStorage.removeItem(UI_SETTINGS_STORAGE_KEY);
}

init();
