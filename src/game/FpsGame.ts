import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Scalar } from '@babylonjs/core/Maths/math.scalar'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture'
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock'

export interface GameInput {
  moveX: number
  moveY: number
  lookX: number
  lookY: number
  jump: boolean
  slide: boolean
}

type InputReader = () => GameInput

const PLAYER_HEIGHT = 1.8
const PLAYER_RADIUS = 0.3
const HAND_BASE_ROTATION_X = 0.2
const HAND_BASE_ROTATION_Y = 0.22
const HAND_BASE_ROTATION_Z = 0.04
const LEFT_HAND_BASE = new Vector3(-0.22, -0.28, 0.42)
const RIGHT_HAND_BASE = new Vector3(0.22, -0.28, 0.42)
const HAND_SWAY_SENSITIVITY = 0.00095
const HAND_SWAY_X_POSITION_FACTOR = 0.2
const HAND_SWAY_Y_POSITION_FACTOR = 0.35
const HAND_SWAY_ROTATION_X_FACTOR = 1.3
const HAND_SWAY_ROTATION_Y_FACTOR = 1.45
const HAND_SWAY_ROTATION_Z_FACTOR = 1.3

export class FpsGame {
  private readonly canvas: HTMLCanvasElement
  private readonly readInput: InputReader
  private readonly onLoadingChange: (loading: boolean) => void
  private engine: Engine | null = null
  private scene: Scene | null = null
  private camera: UniversalCamera | null = null
  private player: Mesh | null = null
  private ground: Mesh | null = null
  private labelPlane: Mesh | null = null
  private labelTexture: AdvancedDynamicTexture | null = null
  private groundMaterial: StandardMaterial | null = null
  private playerMaterial: StandardMaterial | null = null
  private handMaterial: PBRMaterial | null = null
  private light: HemisphericLight | null = null
  private sunLight: DirectionalLight | null = null
  private handRig: TransformNode | null = null
  private leftHand: TransformNode | null = null
  private rightHand: TransformNode | null = null
  private velocity = Vector3.Zero()
  private yaw = 0
  private pitch = 0
  private handBobTime = 0
  private handSwayX = 0
  private handSwayY = 0
  private isGrounded = true
  private isSliding = false
  private slideRemaining = 0
  private isRendering = false
  private readonly visibilityHandler = () => {
    if (document.hidden) {
      this.stopRenderLoop()
      return
    }
    this.startRenderLoop()
  }

  constructor(
    canvas: HTMLCanvasElement,
    readInput: InputReader,
    onLoadingChange: (loading: boolean) => void,
  ) {
    this.canvas = canvas
    this.readInput = readInput
    this.onLoadingChange = onLoadingChange
  }

  async initialize(): Promise<void> {
    this.onLoadingChange(true)

    const engine = new Engine(this.canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: false,
    })
    engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 2))

    const scene = new Scene(engine)
    scene.useRightHandedSystem = true
    scene.autoClear = true
    scene.clearColor.set(0.52, 0.7, 0.95, 1)
    scene.fogMode = Scene.FOGMODE_EXP2
    scene.fogDensity = 0.0065
    scene.fogColor = new Color3(0.62, 0.75, 0.95)

    const camera = new UniversalCamera('fps-camera', new Vector3(0, 1.6, 0), scene)
    camera.minZ = 0.1
    camera.fov = 1.05
    camera.inputs.clear()
    scene.activeCamera = camera

    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
    light.intensity = 0.7
    light.groundColor = new Color3(0.32, 0.34, 0.4)

    const sunLight = new DirectionalLight('sun-light', new Vector3(-0.4, -1, 0.35), scene)
    sunLight.position = new Vector3(25, 40, -20)
    sunLight.intensity = 1.05

    const ground = MeshBuilder.CreateGround(
      'ground',
      {
        width: 150,
        height: 150,
        subdivisions: 1,
      },
      scene,
    )
    const groundMaterial = new StandardMaterial('ground-mat', scene)
    groundMaterial.diffuseColor = new Color3(0.2, 0.55, 0.22)
    groundMaterial.specularColor = Color3.Black()
    ground.material = groundMaterial

    const player = MeshBuilder.CreateCapsule(
      'player',
      {
        height: PLAYER_HEIGHT,
        radius: PLAYER_RADIUS,
        tessellation: 6,
      },
      scene,
    )
    player.position.y = PLAYER_HEIGHT / 2
    const playerMaterial = new StandardMaterial('player-mat', scene)
    playerMaterial.diffuseColor = new Color3(0.82, 0.85, 0.95)
    playerMaterial.specularColor = Color3.Black()
    player.material = playerMaterial

    camera.parent = player
    camera.position = new Vector3(0, 1.6, 0)

    const handRig = new TransformNode('hand-rig', scene)
    handRig.parent = camera

    const handMaterial = new PBRMaterial('hand-mat', scene)
    handMaterial.albedoColor = new Color3(0.96, 0.77, 0.67)
    handMaterial.metallic = 0
    handMaterial.roughness = 0.58
    handMaterial.environmentIntensity = 0.9

    const leftHand = this.createHand('left', handRig, handMaterial, scene)
    const rightHand = this.createHand('right', handRig, handMaterial, scene)

    const labelPlane = MeshBuilder.CreatePlane(
      'player-label-plane',
      { size: 0.6 },
      scene,
    )
    labelPlane.parent = player
    labelPlane.position = new Vector3(0, 1.4, 0)
    labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
    const labelTexture = AdvancedDynamicTexture.CreateForMesh(labelPlane, 256, 128, false)
    const text = new TextBlock('player-label', 'PLAYER')
    text.color = 'white'
    text.fontSize = 42
    labelTexture.addControl(text)

    this.engine = engine
    this.scene = scene
    this.camera = camera
    this.player = player
    this.ground = ground
    this.labelPlane = labelPlane
    this.labelTexture = labelTexture
    this.groundMaterial = groundMaterial
    this.playerMaterial = playerMaterial
    this.handMaterial = handMaterial
    this.light = light
    this.sunLight = sunLight
    this.handRig = handRig
    this.leftHand = leftHand
    this.rightHand = rightHand

    window.addEventListener('resize', this.handleResize)
    document.addEventListener('visibilitychange', this.visibilityHandler)

    await scene.whenReadyAsync()
    this.onLoadingChange(false)
    this.startRenderLoop()
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.visibilityHandler)
    window.removeEventListener('resize', this.handleResize)

    this.stopRenderLoop()

    this.labelTexture?.dispose()
    this.labelTexture = null

    this.labelPlane?.dispose(false, false)
    this.labelPlane = null

    this.player?.dispose(false, false)
    this.player = null

    this.ground?.dispose(false, false)
    this.ground = null

    this.groundMaterial?.dispose()
    this.groundMaterial = null

    this.playerMaterial?.dispose()
    this.playerMaterial = null

    this.light?.dispose()
    this.light = null
    this.sunLight?.dispose()
    this.sunLight = null

    this.leftHand?.dispose(false, false)
    this.leftHand = null

    this.rightHand?.dispose(false, false)
    this.rightHand = null

    this.handRig?.dispose(false, false)
    this.handRig = null

    this.handMaterial?.dispose()
    this.handMaterial = null

    this.scene?.dispose()
    this.scene = null
    this.camera = null

    this.engine?.dispose()
    this.engine = null
  }

  private readonly handleResize = () => {
    this.engine?.resize()
  }

  private startRenderLoop(): void {
    if (!this.engine || !this.scene || this.isRendering) {
      return
    }
    this.isRendering = true
    this.engine.runRenderLoop(() => {
      if (!this.engine || !this.scene) {
        return
      }
      const dt = this.engine.getDeltaTime() / 1000
      this.update(dt)
      this.scene.render()
    })
  }

  private stopRenderLoop(): void {
    if (!this.engine || !this.isRendering) {
      return
    }
    this.engine.stopRenderLoop()
    this.isRendering = false
  }

  private update(deltaSec: number): void {
    if (!this.player || !this.camera) {
      return
    }

    const dt = Math.min(0.033, Math.max(0.001, deltaSec))
    const input = this.readInput()

    const lookSensitivity = 0.003
    this.yaw += input.lookX * lookSensitivity
    this.pitch = Scalar.Clamp(
      this.pitch + input.lookY * lookSensitivity,
      -Math.PI * 0.45,
      Math.PI * 0.45,
    )

    this.player.rotationQuaternion = null
    this.player.rotation.y = this.yaw
    this.camera.rotation = new Vector3(this.pitch, 0, 0)

    const moveInput = new Vector3(input.moveX, 0, input.moveY)
    if (moveInput.lengthSquared() > 1) {
      moveInput.normalize()
    }

    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const desired = right.scale(moveInput.x).add(forward.scale(moveInput.z))

    const isMoving = desired.lengthSquared() > 0.001
    const walkingSpeed = 4
    const slidingSpeed = 8

    if (input.slide && this.isGrounded && isMoving && !this.isSliding) {
      this.isSliding = true
      this.slideRemaining = 0.6
    }
    if (this.isSliding) {
      this.slideRemaining -= dt
      if (this.slideRemaining <= 0) {
        this.isSliding = false
      }
    }

    const targetSpeed = this.isSliding ? slidingSpeed : walkingSpeed
    const targetVelocity = desired.scale(targetSpeed)
    const smoothing = this.isGrounded ? 22 : 8
    const blend = Scalar.Clamp(smoothing * dt, 0, 1)

    this.velocity.x = Scalar.Lerp(this.velocity.x, targetVelocity.x, blend)
    this.velocity.z = Scalar.Lerp(this.velocity.z, targetVelocity.z, blend)

    if (input.jump && this.isGrounded) {
      this.velocity.y = 7.8
      this.isGrounded = false
      this.isSliding = false
    }

    this.velocity.y -= 23 * dt

    const nextPosition = this.player.position.add(this.velocity.scale(dt))
    const minY = PLAYER_HEIGHT / 2
    if (nextPosition.y <= minY) {
      nextPosition.y = minY
      this.velocity.y = 0
      this.isGrounded = true
    }
    this.player.position.copyFrom(nextPosition)

    const standingEye = 1.6
    const slidingEye = 1.15
    const targetEye = this.isSliding ? slidingEye : standingEye
    const eyeBlend = Scalar.Clamp(10 * dt, 0, 1)
    this.camera.position.y = Scalar.Lerp(this.camera.position.y, targetEye, eyeBlend)

    this.updateHands(dt, input, isMoving)
  }

  private createHand(
    side: 'left' | 'right',
    parent: TransformNode,
    material: PBRMaterial,
    scene: Scene,
  ): TransformNode {
    const sign = side === 'left' ? -1 : 1
    const hand = new TransformNode(`${side}-hand`, scene)
    hand.parent = parent
    hand.position.copyFrom(side === 'left' ? LEFT_HAND_BASE : RIGHT_HAND_BASE)
    hand.rotation = new Vector3(
      HAND_BASE_ROTATION_X,
      sign * HAND_BASE_ROTATION_Y,
      sign * HAND_BASE_ROTATION_Z,
    )

    const palm = MeshBuilder.CreateBox(
      `${side}-palm`,
      {
        width: 0.105,
        height: 0.08,
        depth: 0.14,
      },
      scene,
    )
    palm.parent = hand
    palm.position = new Vector3(0, -0.01, 0)
    palm.material = material

    const fingerXs = [-0.032, -0.011, 0.011, 0.032]
    fingerXs.forEach((x, index) => {
      const finger = MeshBuilder.CreateCapsule(
        `${side}-finger-${index}`,
        {
          radius: 0.011,
          height: 0.07,
          tessellation: 8,
          subdivisions: 1,
        },
        scene,
      )
      finger.parent = hand
      finger.rotation.x = Math.PI * 0.5
      finger.position = new Vector3(x, -0.005, 0.082)
      finger.material = material
    })

    const thumb = MeshBuilder.CreateCapsule(
      `${side}-thumb`,
      {
        radius: 0.012,
        height: 0.062,
        tessellation: 8,
        subdivisions: 1,
      },
      scene,
    )
    thumb.parent = hand
    thumb.rotation = new Vector3(Math.PI * 0.58, 0, sign * (Math.PI * 0.28))
    thumb.position = new Vector3(sign * 0.055, -0.005, 0.01)
    thumb.material = material

    return hand
  }

  private updateHands(dt: number, input: GameInput, isMoving: boolean): void {
    if (!this.leftHand || !this.rightHand) {
      return
    }

    const bobSpeed = this.isSliding ? 15 : isMoving ? 11 : 5
    this.handBobTime += dt * bobSpeed
    const bobAmount = this.isSliding ? 0.02 : isMoving ? 0.012 : 0.003
    const bobX = Math.sin(this.handBobTime) * bobAmount
    const bobY = Math.cos(this.handBobTime * 2) * bobAmount * 0.45

    const targetSwayX = Scalar.Clamp(-input.lookX * HAND_SWAY_SENSITIVITY, -0.05, 0.05)
    const targetSwayY = Scalar.Clamp(input.lookY * HAND_SWAY_SENSITIVITY, -0.05, 0.05)
    const swayBlend = Scalar.Clamp(18 * dt, 0, 1)
    this.handSwayX = Scalar.Lerp(this.handSwayX, targetSwayX, swayBlend)
    this.handSwayY = Scalar.Lerp(this.handSwayY, targetSwayY, swayBlend)

    this.leftHand.position.x = LEFT_HAND_BASE.x + bobX - this.handSwayX * HAND_SWAY_X_POSITION_FACTOR
    this.leftHand.position.y = LEFT_HAND_BASE.y + bobY - this.handSwayY * HAND_SWAY_Y_POSITION_FACTOR
    this.leftHand.rotation.x = HAND_BASE_ROTATION_X - this.handSwayY * HAND_SWAY_ROTATION_X_FACTOR
    this.leftHand.rotation.y = -HAND_BASE_ROTATION_Y + this.handSwayX * HAND_SWAY_ROTATION_Y_FACTOR
    this.leftHand.rotation.z = -HAND_BASE_ROTATION_Z + this.handSwayX * HAND_SWAY_ROTATION_Z_FACTOR

    this.rightHand.position.x =
      RIGHT_HAND_BASE.x + bobX - this.handSwayX * HAND_SWAY_X_POSITION_FACTOR
    this.rightHand.position.y = RIGHT_HAND_BASE.y + bobY - this.handSwayY * HAND_SWAY_Y_POSITION_FACTOR
    this.rightHand.rotation.x = HAND_BASE_ROTATION_X - this.handSwayY * HAND_SWAY_ROTATION_X_FACTOR
    this.rightHand.rotation.y = -HAND_BASE_ROTATION_Y + this.handSwayX * HAND_SWAY_ROTATION_Y_FACTOR
    this.rightHand.rotation.z = HAND_BASE_ROTATION_Z - this.handSwayX * HAND_SWAY_ROTATION_Z_FACTOR
  }
}
