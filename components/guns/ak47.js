// components/guns/ak47.js

// グローバルなTHREEオブジェクトを使用することを前提としています
export default {
    name: "AK-47",
    type: "assault_rifle",
    stats: {
        multipliers: { head: 1.55, arm: 1.0, chest: 1.1, belly: 1.0, leg: 1.0 },
        damageRanges: [
            { maxDist: 20, damage: 33 },
            { maxDist: 30, damage: 26 },
            { maxDist: 55, damage: 23 },
            { maxDist: 60, damage: 21 }
        ],
        fireInterval: 110,
        adsTime: 250,
        sprintToFireTime: 160,
        reloadTime: 1420,
        emptyReloadTime: 1630,
        magSize: 30,
        maxAmmo: 120,
        spread: {
            hip: { x: 0.10, y: 0.10 },
            ads: { x: 0.002, y: 0.002 },
            sprint: { x: 0.25, y: 0.25 }
        },
        recoil: {
            kick: 0.1,
            rise: 0.015,
            recover: 15.0,
            kickZ: 0.12
        }
    },
    mobility: {
        walk: -0.05,
        sprint: -0.05,
        ads: -0.10
    },
    visuals: {
        // ここで直接 THREE.Vector3 を定義できるのが JS にする最大のメリットです
        hipPos: new THREE.Vector3(
            0.25,
            -0.1,
            -0.55
        ),
        adsPos: new THREE.Vector3(
            0.0,
            -0.1044,
            -0.6
        ),
        hipFov: 90,
        adsFov: 50,
        swayAmount: 0.03,
        swaySmooth: 8.0,
        bobAmount: 0.03,
        bobSpeed: 14,
        recoilShake: 0.005,
        slideTravel: 0.08,
        slideSpeed: 20,
    },

    // メッシュ生成ロジックもこのファイルにカプセル化します
    createMesh: function() {
        const group = new THREE.Group(); 
        group.scale.set(1.2, 1.2, 1.2);

        const metalMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.8 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.3 });
        const lensMat = new THREE.MeshStandardMaterial({ color: 0x66cccc, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
        const reticleMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xeebb99, roughness: 0.6, metalness: 0.1 });

        group.add(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.090, 0.6), metalMat));
        
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.25), darkMat); 
        stock.position.set(0, -0.05, 0.4); 
        group.add(stock);
        
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.12), darkMat); 
        mag.position.set(0, -0.15, 0.05); mag.rotation.x = 0.2; mag.name = "mag"; 
        mag.userData.originalPos = mag.position.clone(); mag.userData.originalRot = mag.rotation.clone(); 
        group.add(mag);

        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.1), darkMat); 
        grip.position.set(0, -0.12, 0.2); grip.rotation.x = -0.2; 
        group.add(grip);

        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.45), metalMat); 
        barrel.position.set(0, 0.02, -0.45); 
        group.add(barrel);
        
        const sightGroup = new THREE.Group();
        sightGroup.position.set(0, 0.052, 0.1); 
        group.add(sightGroup);

        const mountGeo = new THREE.BoxGeometry(0.054, 0.015, 0.10);
        const mount = new THREE.Mesh(mountGeo, darkMat);
        sightGroup.add(mount);

        const bodyBaseGeo = new THREE.BoxGeometry(0.048, 0.02, 0.08);
        const bodyBase = new THREE.Mesh(bodyBaseGeo, darkMat);
        bodyBase.position.y = 0.015;
        sightGroup.add(bodyBase);

        const frameThick = 0.004, frameWidth = 0.052, frameHeight = 0.04; 
        const lPillar = new THREE.Mesh(new THREE.BoxGeometry(frameThick, frameHeight, 0.01), darkMat);
        lPillar.position.set(-(frameWidth/2 - frameThick/2), 0.015 + frameHeight/2, -0.03);
        sightGroup.add(lPillar);

        const rPillar = new THREE.Mesh(new THREE.BoxGeometry(frameThick, frameHeight, 0.01), darkMat);
        rPillar.position.set((frameWidth/2 - frameThick/2), 0.015 + frameHeight/2, -0.03);
        sightGroup.add(rPillar);

        const topBeam = new THREE.Mesh(new THREE.BoxGeometry(frameWidth, frameThick, 0.01), darkMat);
        topBeam.position.set(0, 0.015 + frameHeight, -0.03);
        sightGroup.add(topBeam);

        const projector = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.04), darkMat);
        projector.position.set(0, 0.015, 0.02);
        sightGroup.add(projector);

        const lensGeo = new THREE.BoxGeometry(frameWidth - 0.005, frameHeight - 0.005, 0.002);
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.position.set(0, 0.015 + frameHeight/2, -0.03);
        sightGroup.add(lens);

        const dotGeo = new THREE.PlaneGeometry(0.0025, 0.0025);
        const dot = new THREE.Mesh(dotGeo, reticleMat);
        dot.position.set(0, 0.015 + frameHeight/2, -0.028); dot.rotation.y = Math.PI; 
        sightGroup.add(dot);

        const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.8), skinMat); 
        rArm.position.set(0.1, -0.15, 0.6); rArm.rotation.set(0, 0.35, 0.35); 
        group.add(rArm);
        
        const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1.1), skinMat); 
        lArm.position.set(-0.21, -0.02, 0.2); lArm.rotation.set(0, -0.4, 0.3); lArm.name = "leftArm";
        lArm.userData.originalPos = lArm.position.clone(); lArm.userData.originalRot = lArm.rotation.clone(); 
        group.add(lArm);
        
        return group;
    }
};