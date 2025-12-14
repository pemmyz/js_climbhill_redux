'use strict';

window.addEventListener('load', () => {

    // A. CONFIG
    const PPM = 1; 
    const PHYSICS_STEP = 1 / 60; 
    const MAX_ACCUMULATOR_STEPS = 5;

    const VEHICLE_PARAMS = {
        CHASSIS_MASS: 180,
        REAR_BAR_DIM: { w: 1.2, h: 0.25 },
        FRONT_BAR_DIM: { w: 0.8, h: 0.25 },
        FRONT_BAR_OFFSET: { x: 0.8, y: -0.05 },
        WHEEL_MASS: 12, WHEEL_RADIUS: 0.35, WHEEL_FRICTION: 1.6, WHEEL_RESTITUTION: 0.05,
        TRACK_WIDTH: 1.5,
        SUSPENSION_FREQ_HZ: 2.0, SUSPENSION_DAMPING_RATIO: 0.45, SUSPENSION_TRAVEL: 0.35,
        MOTOR_TORQUE: 900, MOTOR_MAX_SPEED: 70, BRAKE_TORQUE: 1800,
        AIR_CONTROL_TORQUE: 1800, AIR_CONTROL_DAMPING: 30
    };

    const TERRAIN_PARAMS = { 
        SEGMENT_LENGTH: 100, 
        SAMPLE_DISTANCE: 1.2, 
        MAX_SLOPE: 0.8, 
        GENERATION_THRESHOLD: 200, 
        CULLING_THRESHOLD: 150, 
        A1: 0.8, F1: 0.4, P1: 0, A2: 0.3, F2: 1.2, P2: 0 
    };
    const GAME_PARAMS = { FUEL_START: 100, FUEL_DRAIN_RATE: 0.5, CHECKPOINT_DISTANCE: 150 };

    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

    // B. GLOBALS
    const pl = planck, Vec2 = pl.Vec2;
    let world, vehicle, terrainManager;
    let scene, camera, renderer, sunLight;
    
    // Configurable state
    let cameraZoom = 28; // Default Z distance

    let gameState = { paused: false, debug: false, gameOver: false, distance: 0, fuel: GAME_PARAMS.FUEL_START, lastCheckpoint: null };

    // C. THREE.JS SETUP
    function initGraphics() {
        const canvas = document.getElementById('game-canvas');
        
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 20, 80);

        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        // Initial position, z will be overridden by cameraZoom
        camera.position.set(0, 5, cameraZoom);

        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap; 

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
        sunLight.position.set(10, 20, 10);
        sunLight.castShadow = true;
        
        sunLight.shadow.mapSize.width = 1024;
        sunLight.shadow.mapSize.height = 1024;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 100;
        sunLight.shadow.camera.left = -30;
        sunLight.shadow.camera.right = 30;
        sunLight.shadow.camera.top = 30;
        sunLight.shadow.camera.bottom = -30;
        scene.add(sunLight);

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    // D. PHYSICS SETUP
    function initPhysics() {
        world = pl.World({ gravity: Vec2(0, -10) });
        world.on('begin-contact', (c) => handleContact(c, true));
        world.on('end-contact', (c) => handleContact(c, false));
    }

    function handleContact(contact, isBeginning) {
        const getData = (fixture) => fixture.getUserData() || fixture.getBody().getUserData();
        const dA = getData(contact.getFixtureA()), dB = getData(contact.getFixtureB());
        if(!dA || !dB) return;
        
        const checkGround = (w, g) => {
            if (w.type === 'wheel' && g.type === 'ground') w.owner.setGrounded(w.wheelId, isBeginning);
        };
        checkGround(dA, dB); checkGround(dB, dA);

        if (isBeginning) {
            const checkCol = (c, item, fix) => {
                if (c.type === 'chassis') {
                    if (item.type === 'checkpoint') {
                        gameState.lastCheckpoint = { pos: vehicle.chassis.getPosition(), angle: vehicle.chassis.getAngle() };
                        removeBodyAndMesh(fix.getBody());
                    }
                    if (item.type === 'fuel') {
                        gameState.fuel = Math.min(100, gameState.fuel + 50);
                        removeBodyAndMesh(fix.getBody());
                    }
                }
            };
            checkCol(dA, dB, contact.getFixtureB());
            checkCol(dB, dA, contact.getFixtureA());
        }
    }

    function removeBodyAndMesh(body) {
        if (body.getUserData() && body.getUserData().mesh) {
            const mesh = body.getUserData().mesh;
            scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                else mesh.material.dispose();
            }
        }
        world.destroyBody(body);
    }

    // E. INPUT
    const input = {
        throttle: 0, brake: 0, pitch: 0, keys: new Set(),
        init() {
            // Panels
            const helpPanel = document.getElementById('help-panel');
            const optionsPanel = document.getElementById('options-panel');
            
            // Toggle Logic
            const togglePanel = (panel) => {
                const isHidden = panel.classList.contains('hidden');
                // Close all first
                helpPanel.classList.add('hidden');
                optionsPanel.classList.add('hidden');
                // Open if it was hidden
                if(isHidden) panel.classList.remove('hidden');
            };

            // Help Bindings
            const helpBtn = document.getElementById('help-toggle-button');
            const closeHelpBtn = document.getElementById('close-help-btn');
            if(helpBtn) helpBtn.onclick = () => togglePanel(helpPanel);
            if(closeHelpBtn) closeHelpBtn.onclick = () => helpPanel.classList.add('hidden');

            // Options Bindings
            const optionsBtn = document.getElementById('options-toggle-button');
            const closeOptionsBtn = document.getElementById('close-options-btn');
            if(optionsBtn) optionsBtn.onclick = () => togglePanel(optionsPanel);
            if(closeOptionsBtn) closeOptionsBtn.onclick = () => optionsPanel.classList.add('hidden');

            // Zoom Slider Binding
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomDisplay = document.getElementById('zoom-display');
            if(zoomSlider) {
                zoomSlider.oninput = (e) => {
                    cameraZoom = parseFloat(e.target.value);
                    if(zoomDisplay) zoomDisplay.textContent = cameraZoom;
                };
            }

            // General Bindings
            const restartBtn = document.getElementById('restart-btn');
            if(restartBtn) restartBtn.onclick = () => this.handleReset();

            window.addEventListener('keydown', e => this.keys.add(e.code));
            window.addEventListener('keyup', e => {
                this.keys.delete(e.code);
                if (e.code === 'KeyR') this.handleReset();
                if (e.code === 'Space') gameState.paused = !gameState.paused;
                if (e.code === 'KeyH') togglePanel(helpPanel);
                if (e.code === 'KeyO') togglePanel(optionsPanel);
                if (e.code === 'KeyD') {
                    gameState.debug = !gameState.debug;
                    scene.traverse(o => { if(o.name === 'debug') o.visible = gameState.debug; });
                }
            });

            // Mobile Bindings
            const setupMob = (id, fn) => {
                const b = document.getElementById(id);
                if (!b) return;
                b.addEventListener('touchstart', (e) => { e.preventDefault(); fn(1); });
                b.addEventListener('touchend', (e) => { e.preventDefault(); fn(0); });
                b.addEventListener('mousedown', (e) => { e.preventDefault(); fn(1); });
                b.addEventListener('mouseup', (e) => { e.preventDefault(); fn(0); });
            };
            setupMob('throttle-btn', v => this.throttle = v);
            setupMob('brake-btn', v => this.brake = v);
            setupMob('tilt-forward-btn', v => this.pitch = v);
            setupMob('tilt-backward-btn', v => this.pitch = -v);
        },
        update() {
            this.throttle = this.keys.has('ArrowUp') ? 1 : 0;
            this.brake = this.keys.has('ArrowDown') ? 1 : 0;
            this.pitch = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
            
            const tBtn = document.getElementById('throttle-btn');
            if(tBtn && tBtn.matches(':active')) this.throttle = 1;
        },
        handleReset() {
            if (gameState.lastCheckpoint) {
                vehicle.reset(gameState.lastCheckpoint.pos, 0);
                gameState.fuel = Math.max(25, gameState.fuel);
            } else {
                vehicle.reset(Vec2(0, 5), 0);
                gameState.fuel = 100;
            }
            gameState.gameOver = false;
            document.getElementById('game-over-panel').classList.add('hidden');
        }
    };

    // F. TERRAIN GENERATION
    function createTerrainManager() {
        let segments = [], lastGenX = 0;
        let lastChk = 0;
        let lastFuel = 0;
        
        const seed = Math.random() * 1000;
        const heightFn = x => 
            TERRAIN_PARAMS.A1 * Math.sin(TERRAIN_PARAMS.F1 * x + seed) + 
            TERRAIN_PARAMS.A2 * Math.sin(TERRAIN_PARAMS.F2 * x + seed + 100);

        const generate = (startX) => {
            const points = [], vPoints = []; 
            let lastY = heightFn(startX);
            
            points.push(Vec2(startX, lastY));
            vPoints.push(new THREE.Vector2(startX, lastY));

            for (let x = startX + TERRAIN_PARAMS.SAMPLE_DISTANCE; x <= startX + TERRAIN_PARAMS.SEGMENT_LENGTH; x += TERRAIN_PARAMS.SAMPLE_DISTANCE) {
                let y = heightFn(x);
                const slope = (y - lastY) / TERRAIN_PARAMS.SAMPLE_DISTANCE;
                if (Math.abs(slope) > TERRAIN_PARAMS.MAX_SLOPE) {
                    y = lastY + Math.sign(slope) * TERRAIN_PARAMS.MAX_SLOPE * TERRAIN_PARAMS.SAMPLE_DISTANCE;
                }
                points.push(Vec2(x, y));
                vPoints.push(new THREE.Vector2(x, y));
                lastY = y;
            }
            
            const body = world.createBody(Vec2.zero());
            body.createFixture(pl.Chain(points, false), { friction: 0.9, userData: { type: 'ground' } });
            
            vPoints.push(new THREE.Vector2(vPoints[vPoints.length-1].x, -50));
            vPoints.push(new THREE.Vector2(startX, -50));
            
            const shape = new THREE.Shape(vPoints);
            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: 20,
                bevelEnabled: false,
                steps: 1 
            });
            geometry.translate(0, 0, -10);

            const material = new THREE.MeshStandardMaterial({ 
                color: 0x2b2b2b, 
                roughness: 0.8,
                flatShading: true
            });
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.receiveShadow = true;
            mesh.matrixAutoUpdate = false; 
            mesh.updateMatrix();

            scene.add(mesh);
            
            body.setUserData({ mesh: mesh, type: 'ground' });
            segments.push({ body, endX: startX + TERRAIN_PARAMS.SEGMENT_LENGTH });
            lastGenX = startX + TERRAIN_PARAMS.SEGMENT_LENGTH;

            for(let i=1; i<points.length-1; i++) {
                if (points[i].y > points[i-1].y && points[i].y > points[i+1].y) {
                    if (points[i].x > (lastChk + GAME_PARAMS.CHECKPOINT_DISTANCE)) {
                        createItem(points[i].x, points[i].y + 1, 'checkpoint');
                        lastChk = points[i].x;
                    } else if (points[i].x > (lastFuel + 200)) {
                        createItem(points[i].x, points[i].y + 1, 'fuel');
                        lastFuel = points[i].x;
                    }
                }
            }
        };

        return {
            init() { generate(-TERRAIN_PARAMS.SEGMENT_LENGTH); generate(0); },
            update(camX) {
                if (camX > lastGenX - TERRAIN_PARAMS.GENERATION_THRESHOLD) generate(lastGenX);
                if (segments.length > 0 && camX > segments[0].endX + TERRAIN_PARAMS.CULLING_THRESHOLD) {
                    removeBodyAndMesh(segments[0].body);
                    segments.shift();
                }
            },
            getSlope(x) { 
                let s = 0;
                world.rayCast(Vec2(x, 50), Vec2(x, -50), (f, p, n) => { 
                    const ud = f.getUserData() || f.getBody().getUserData();
                    if(ud && ud.type === 'ground') { 
                        s = -n.x/n.y; 
                        return 0; 
                    } 
                    return -1; 
                });
                return s;
            }
        };
    }

    function createItem(x, y, type) {
        const body = world.createBody({ type: 'static', position: Vec2(x, y) });
        body.createFixture(pl.Box(0.5, 0.5), { isSensor: true, userData: { type } });
        
        let geometry, material;
        if (type === 'checkpoint') {
            geometry = new THREE.CylinderGeometry(0.1, 0.1, 2, 8);
            material = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xaa6600, emissiveIntensity: 0.5 });
        } else {
            geometry = new THREE.BoxGeometry(0.6, 0.8, 0.6);
            material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, 0);
        mesh.castShadow = true;
        
        mesh.userData = { originalY: y, floatOffset: Math.random() * Math.PI * 2 };
        scene.add(mesh);
        body.setUserData({ mesh, type });
    }

    // G. VEHICLE FACTORY
    function createVehicle(pos) {
        const vp = VEHICLE_PARAMS;

        const chassis = world.createDynamicBody({ position: pos, angularDamping: 0.1 });
        const density = vp.CHASSIS_MASS / 1.0; 
        
        chassis.createFixture(pl.Box(vp.REAR_BAR_DIM.w/2, vp.REAR_BAR_DIM.h/2, Vec2(-0.2, 0)), { density, filterGroupIndex: -1 });
        chassis.createFixture(pl.Box(vp.FRONT_BAR_DIM.w/2, vp.FRONT_BAR_DIM.h/2, Vec2(vp.FRONT_BAR_OFFSET.x, vp.FRONT_BAR_OFFSET.y)), { density, filterGroupIndex: -1 });
        chassis.setUserData({ type: 'chassis' });

        const chassisGroup = new THREE.Group();
        const rearMat = new THREE.MeshStandardMaterial({ color: 0x3366cc, roughness: 0.4, metalness: 0.6 });
        const rearGeo = new THREE.BoxGeometry(vp.REAR_BAR_DIM.w, vp.REAR_BAR_DIM.h, 1);
        const rearMesh = new THREE.Mesh(rearGeo, rearMat);
        rearMesh.position.set(-0.2, 0, 0);
        rearMesh.castShadow = true;

        const frontGeo = new THREE.BoxGeometry(vp.FRONT_BAR_DIM.w, vp.FRONT_BAR_DIM.h, 0.8);
        const frontMesh = new THREE.Mesh(frontGeo, rearMat);
        frontMesh.position.set(vp.FRONT_BAR_OFFSET.x, vp.FRONT_BAR_OFFSET.y, 0);
        frontMesh.castShadow = true;
        
        const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        cockpit.position.set(-0.2, 0.35, 0);
        
        chassisGroup.add(rearMesh, frontMesh, cockpit);
        scene.add(chassisGroup);
        chassis.setUserData({ mesh: chassisGroup, type: 'chassis' });

        const makeWheel = (xOffset, label) => {
            const wheelBody = world.createDynamicBody({ position: chassis.getWorldPoint(Vec2(xOffset, -1)), angularDamping: 0.1 });
            wheelBody.createFixture(pl.Circle(vp.WHEEL_RADIUS), { density: vp.WHEEL_MASS, friction: vp.WHEEL_FRICTION, restitution: 0, filterGroupIndex: -1, userData: { type: 'wheel', wheelId: label, owner: null } });
            
            const joint = world.createJoint(pl.WheelJoint({
                motorSpeed: 0, enableMotor: false, maxMotorTorque: 0,
                frequencyHz: vp.SUSPENSION_FREQ_HZ, dampingRatio: vp.SUSPENSION_DAMPING_RATIO
            }, chassis, wheelBody, chassis.getWorldPoint(Vec2(xOffset, -1)), chassis.getWorldVector(Vec2(0, 1))));

            const wGeo = new THREE.CylinderGeometry(vp.WHEEL_RADIUS, vp.WHEEL_RADIUS, 0.4, 16);
            wGeo.rotateX(Math.PI / 2);
            const wMesh = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
            
            const rim = new THREE.Mesh(new THREE.BoxGeometry(vp.WHEEL_RADIUS*1.5, 0.1, 0.45), new THREE.MeshStandardMaterial({color: 0x888888}));
            wMesh.add(rim);
            wMesh.castShadow = true;
            scene.add(wMesh);
            wheelBody.setUserData({ mesh: wMesh });

            return { body: wheelBody, joint: joint, mesh: wMesh };
        };

        const rear = makeWheel(-vp.TRACK_WIDTH/2, 'rear');
        const front = makeWheel(vp.TRACK_WIDTH/2, 'front');

        const obj = {
            chassis, rear: rear.body, front: front.body, rJoint: rear.joint, fJoint: front.joint,
            grounded: { rear: 0, front: 0 },
            totalTorque: 0,
            setGrounded(id, val) { this.grounded[id] += val ? 1 : -1; },
            reset(pos, ang) {
                this.chassis.setPosition(pos); this.chassis.setAngle(ang); this.chassis.setLinearVelocity(Vec2(0,0)); this.chassis.setAngularVelocity(0);
                const rPos = chassis.getWorldPoint(Vec2(-vp.TRACK_WIDTH/2, -1));
                const fPos = chassis.getWorldPoint(Vec2(vp.TRACK_WIDTH/2, -1));
                this.rear.setPosition(rPos); this.rear.setLinearVelocity(Vec2(0,0)); this.rear.setAngularVelocity(0);
                this.front.setPosition(fPos); this.front.setLinearVelocity(Vec2(0,0)); this.front.setAngularVelocity(0);
            },
            update(dt, input) {
                if (input.throttle) {
                    this.rJoint.enableMotor(true);
                    this.rJoint.setMotorSpeed(-input.throttle * vp.MOTOR_MAX_SPEED);
                    this.rJoint.setMaxMotorTorque(vp.MOTOR_TORQUE);
                } else {
                    this.rJoint.enableMotor(false);
                    if (this.grounded.rear > 0) this.rear.applyTorque(-this.rear.getAngularVelocity() * 10, true);
                }
                if (input.brake) {
                    this.rear.applyTorque(clamp(-this.rear.getAngularVelocity()*120, -vp.BRAKE_TORQUE, vp.BRAKE_TORQUE), true);
                    this.front.applyTorque(clamp(-this.front.getAngularVelocity()*120, -vp.BRAKE_TORQUE, vp.BRAKE_TORQUE), true);
                }
                let t = -input.pitch * vp.AIR_CONTROL_TORQUE;
                t -= this.chassis.getAngularVelocity() * vp.AIR_CONTROL_DAMPING;
                this.chassis.applyTorque(t, true);
                this.totalTorque = t;
            }
        };
        
        rear.body.getFixtureList().getUserData().owner = obj;
        front.body.getFixtureList().getUserData().owner = obj;
        
        return obj;
    }

    // H. MAIN LOOP
    let lastTime = 0, accumulator = 0;
    let frameCount = 0; 

    function gameLoop(time) {
        requestAnimationFrame(gameLoop);
        const dt = (time - lastTime) / 1000;
        lastTime = time;

        if (gameState.paused || !world) return;

        input.update();
        
        if (!gameState.gameOver) {
            if (!gameState.debug) {
                gameState.fuel -= (GAME_PARAMS.FUEL_DRAIN_RATE + input.throttle * 4) * dt;
                if (gameState.fuel <= 0) { gameState.fuel = 0; if (vehicle.chassis.getLinearVelocity().length() < 0.1) gameState.gameOver = true; }
            }
        }

        accumulator += dt;
        if(accumulator > 0.1) accumulator = 0.1;

        while (accumulator >= PHYSICS_STEP && accumulator < MAX_ACCUMULATOR_STEPS * PHYSICS_STEP) {
            vehicle.update(PHYSICS_STEP, input);
            world.step(PHYSICS_STEP);
            accumulator -= PHYSICS_STEP;
        }

        // Sync Physics -> Graphics
        for (let b = world.getBodyList(); b; b = b.getNext()) {
            const ud = b.getUserData();
            if (ud && ud.mesh) {
                const p = b.getPosition();
                ud.mesh.position.x = p.x;
                ud.mesh.position.y = p.y;
                ud.mesh.rotation.z = b.getAngle();
                
                if (ud.type === 'fuel' || ud.type === 'checkpoint') {
                    ud.mesh.rotation.y += 2 * dt;
                    ud.mesh.position.y = ud.mesh.userData.originalY + Math.sin(time/500 + ud.mesh.userData.floatOffset) * 0.2;
                }
            }
        }

        // Camera Update 
        const carPos = vehicle.chassis.getPosition();
        camera.position.x = carPos.x + 8; 
        camera.position.y = carPos.y + 6; 
        // Apply variable zoom here
        camera.position.z = cameraZoom;   
        
        // Look at car
        camera.lookAt(carPos.x + 6, carPos.y, 0);

        // Light follows exact car position
        sunLight.position.set(carPos.x + 10, carPos.y + 20, 10);
        sunLight.target.position.set(carPos.x, carPos.y, 0);
        sunLight.target.updateMatrixWorld();

        terrainManager.update(camera.position.x);
        if (vehicle.chassis.getPosition().y < -30) input.handleReset();

        // Throttle DOM
        frameCount++;
        if (frameCount % 10 === 0) {
            document.getElementById('speed-value').textContent = (vehicle.chassis.getLinearVelocity().length() * 3.6).toFixed(0);
            document.getElementById('rpm-value').textContent = Math.abs(vehicle.rear.getAngularVelocity() * 10).toFixed(0);
            document.getElementById('fuel-value').textContent = gameState.fuel.toFixed(0);
            
            document.getElementById('slope-value').textContent = (terrainManager.getSlope(carPos.x)*100).toFixed(0);
            
            document.getElementById('angle-value').textContent = ((vehicle.chassis.getAngle()*180/Math.PI)%360).toFixed(0);
            document.getElementById('torque-value').textContent = vehicle.totalTorque.toFixed(0);
            gameState.distance = Math.max(gameState.distance, carPos.x);
            document.getElementById('distance-value').textContent = gameState.distance.toFixed(1);
        }
        
        if (gameState.gameOver) document.getElementById('game-over-panel').classList.remove('hidden');

        renderer.render(scene, camera);
    }

    // INIT
    initGraphics();
    initPhysics();
    input.init();
    vehicle = createVehicle(Vec2(0, 5));
    terrainManager = createTerrainManager();
    terrainManager.init();
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
});
